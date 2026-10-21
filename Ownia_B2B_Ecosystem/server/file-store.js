// Almacén de archivos de la app: la copia en Ownia de los archivos de Drive que leen las
// landings (JSONs de los pipelines, xlsx de tipos de cambio). Cada archivo se guarda con el
// MISMO id, nombre, carpeta y fecha de modificación que tiene en Drive, así el shim de DriveApp
// (gas-drive.js) devuelve exactamente lo que vería Apps Script — incluidas las claves de caché
// que los módulos arman con getLastUpdated().
//
// El código GAS es sincrónico: lee de la copia en memoria de este store. El backend (disco en
// local, DynamoDB en Ownia) se consulta en segundo plano: al arrancar, después de cada subida
// y cada `pollMs`. Ver CONTEXT.md, "Datos".
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const zlib = require('zlib');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Ids de Drive: letras, dígitos, _ y -. Se valida antes de usarlo como nombre de archivo.
const ID_RE = /^[A-Za-z0-9_-]{10,128}$/;

function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function cleanMeta(m) {
  if (!isValidId(m.id)) throw Object.assign(new Error(`id de archivo inválido: ${m.id}`), { status: 400 });
  if (m.folderId && !isValidId(m.folderId)) throw Object.assign(new Error(`id de carpeta inválido: ${m.folderId}`), { status: 400 });
  const updatedAt = Number(m.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) throw Object.assign(new Error('updatedAt inválido'), { status: 400 });
  return {
    id: m.id,
    name: String(m.name || m.id).slice(0, 500),
    folderId: m.folderId || null,
    mimeType: String(m.mimeType || 'application/octet-stream').slice(0, 200),
    updatedAt,
    size: Number(m.size) || 0,
    sha256: m.sha256 || null,
  };
}

// Backend en disco: <dir>/<id> con el contenido + <dir>/_index.json con la metadata.
// Para desarrollo local y tests (una sola instancia).
class DirBackend {
  constructor(dir) {
    this.dir = path.resolve(dir);
    fs.mkdirSync(this.dir, { recursive: true });
    this.indexPath = path.join(this.dir, '_index.json');
  }

  _index() {
    if (!fs.existsSync(this.indexPath)) return {};
    return JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
  }

  async list() {
    return Object.values(this._index());
  }

  async read(meta) {
    if (!isValidId(meta.id)) throw new Error(`id inválido: ${meta.id}`);
    return fs.readFileSync(path.join(this.dir, meta.id));
  }

  async write(meta, buf) {
    // Primero el contenido, después el índice: un corte a mitad nunca deja metadata sin datos.
    const tmp = path.join(this.dir, `${meta.id}.tmp`);
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, path.join(this.dir, meta.id));
    const idx = this._index();
    idx[meta.id] = meta;
    fs.writeFileSync(this.indexPath + '.tmp', JSON.stringify(idx, null, 1));
    fs.renameSync(this.indexPath + '.tmp', this.indexPath);
  }
}

// Backend en DynamoDB (producción en Ownia: compartido entre instancias, sobrevive a los
// redeploys). Mismo patrón que runrate-html (RR_AI/HTML-RR/backend/reales_store.py):
//   pk="mirror",                  sk="file#<id>"  → puntero: metadata de la versión vigente
//   pk="mirror_blob#<id>#<sha>",  sk="c#0000"…    → contenido gzip en pedazos de 350 KB
// (DynamoDB corta en 400 KB por item). Los pedazos se escriben antes que el puntero: cambiar
// el puntero es el "commit", así nadie lee nunca un archivo a medio subir. Ownia inyecta la
// tabla en APP_SECRETS.DYNAMODB_TABLE y los permisos vienen del rol de la tarea.
const CHUNK_BYTES = 350000;
const PK = 'mirror';

class DynamoBackend {
  constructor(tableName, opts = {}) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    this.table = tableName;
    this.log = opts.log || (() => {});
    this.doc = opts.client || DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
    this.cmd = require('@aws-sdk/lib-dynamodb');
  }

  async _queryAll(pk) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const r = await this.doc.send(new this.cmd.QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ExclusiveStartKey,
      }));
      items.push(...(r.Items || []));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  async list() {
    const items = await this._queryAll(PK);
    // La metadata va como JSON en un string: así no vuelven números como objetos raros.
    return items.filter((i) => String(i.sk).startsWith('file#')).map((i) => JSON.parse(i.cuerpo));
  }

  async read(meta) {
    const items = await this._queryAll(`mirror_blob#${meta.id}#${meta.sha256}`);
    if (!items.length) throw new Error(`archivo ${meta.id}: no hay contenido para la versión ${meta.sha256}`);
    items.sort((a, b) => String(a.sk).localeCompare(String(b.sk)));
    if (items.length !== meta.chunks) throw new Error(`archivo ${meta.id}: ${items.length}/${meta.chunks} pedazos`);
    const buf = await gunzip(Buffer.concat(items.map((i) => Buffer.from(i.data))));
    if (sha256(buf) !== meta.sha256) throw new Error(`archivo ${meta.id}: el contenido no coincide con su sha256`);
    return buf;
  }

  async write(meta, buf) {
    const gz = await gzip(buf);
    const chunks = [];
    for (let i = 0; i < gz.length; i += CHUNK_BYTES) chunks.push(gz.subarray(i, i + CHUNK_BYTES));
    if (!chunks.length) chunks.push(Buffer.alloc(0));
    const blobPk = `mirror_blob#${meta.id}#${meta.sha256}`;
    // BatchWrite: de a 25 items; reintenta lo que DynamoDB devuelve sin procesar.
    for (let i = 0; i < chunks.length; i += 25) {
      let req = chunks.slice(i, i + 25).map((c, j) => ({
        PutRequest: { Item: { pk: blobPk, sk: `c#${String(i + j).padStart(4, '0')}`, data: c } },
      }));
      for (let intento = 0; req.length; intento++) {
        if (intento > 8) throw new Error(`archivo ${meta.id}: DynamoDB no aceptó todos los pedazos`);
        if (intento) await new Promise((r) => setTimeout(r, 100 * 2 ** intento));
        const r = await this.doc.send(new this.cmd.BatchWriteCommand({ RequestItems: { [this.table]: req } }));
        req = (r.UnprocessedItems && r.UnprocessedItems[this.table]) || [];
      }
    }
    const prev = (await this.doc.send(new this.cmd.GetCommand({ TableName: this.table, Key: { pk: PK, sk: `file#${meta.id}` } }))).Item;
    const stored = { ...meta, chunks: chunks.length };
    await this.doc.send(new this.cmd.PutCommand({
      TableName: this.table,
      Item: { pk: PK, sk: `file#${meta.id}`, cuerpo: JSON.stringify(stored) },
    }));
    // Limpieza de la versión anterior. Si falla no pasa nada: quedan pedazos huérfanos.
    // Se espera un poco por si otra instancia la está leyendo justo ahora.
    const prevMeta = prev && JSON.parse(prev.cuerpo);
    if (prevMeta && prevMeta.sha256 !== meta.sha256) {
      setTimeout(() => this._deleteBlob(prevMeta).catch((e) =>
        this.log({ level: 'warn', msg: 'no se pudo borrar la versión anterior', id: meta.id, error: String(e) })), 120000).unref();
    }
    return stored;
  }

  async _deleteBlob(meta) {
    const pk = `mirror_blob#${meta.id}#${meta.sha256}`;
    const items = await this._queryAll(pk);
    for (let i = 0; i < items.length; i += 25) {
      await this.doc.send(new this.cmd.BatchWriteCommand({
        RequestItems: { [this.table]: items.slice(i, i + 25).map((x) => ({ DeleteRequest: { Key: { pk, sk: x.sk } } })) },
      }));
    }
  }
}

class FileStore {
  /**
   * @param {object} backend  { list(): Promise<meta[]>, read(meta): Promise<Buffer>, write(meta, buf) }
   * @param {object} opts     { log }
   */
  constructor(backend, opts = {}) {
    this.backend = backend;
    this.log = opts.log || (() => {});
    this.files = new Map(); // id -> { meta, buf }
    this.version = 0;
    this.listeners = [];
    this.lastRefresh = null;
    this.lastError = null;
    this._refreshing = null;
    this._timer = null;
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  _changed(ids) {
    this.version++;
    for (const fn of this.listeners) {
      try { fn(ids); } catch (e) { this.log({ level: 'error', msg: 'listener de file-store falló', error: String(e) }); }
    }
  }

  /**
   * Trae del backend lo que cambió. Atómico: primero lee TODO lo nuevo y recién después lo
   * aplica y avisa. Si una lectura falla no se aplica nada (los módulos siguen con la versión
   * anterior completa, y el próximo refresh lo reintenta): nunca queda memoria nueva con
   * módulos sin recargar.
   */
  refresh() {
    if (this._refreshing) return this._refreshing;
    this._refreshing = (async () => {
      const metas = (await this.backend.list()).map((m) => ({ ...cleanMeta(m), chunks: m.chunks }));
      const seen = new Set();
      const loaded = [];
      for (const meta of metas) {
        seen.add(meta.id);
        const cur = this.files.get(meta.id);
        if (cur && cur.meta.updatedAt === meta.updatedAt && cur.meta.sha256 === meta.sha256) continue;
        loaded.push({ meta, buf: await this.backend.read(meta) });
      }
      const removed = Array.from(this.files.keys()).filter((id) => !seen.has(id));
      for (const f of loaded) this.files.set(f.meta.id, f);
      for (const id of removed) this.files.delete(id);
      this.lastRefresh = new Date().toISOString();
      this.lastError = null;
      const changed = [...loaded.map((f) => f.meta.id), ...removed];
      if (changed.length) {
        this.log({ level: 'info', msg: 'file-store actualizado', files: changed.length });
        this._changed(changed);
      }
      return changed;
    })()
      .catch((e) => { this.lastError = String(e.message || e); throw e; })
      .finally(() => { this._refreshing = null; });
    return this._refreshing;
  }

  startPolling(ms) {
    if (this._timer || !ms) return;
    this._timer = setInterval(() => {
      this.refresh().catch((e) => this.log({ level: 'error', msg: 'file-store: refresh falló', error: String(e) }));
    }, ms);
    this._timer.unref();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  /** Guarda (o reemplaza) un archivo. `meta.updatedAt` = modifiedTime de Drive en ms. */
  async put(rawMeta, buf) {
    const meta = cleanMeta({ ...rawMeta, size: buf.length, sha256: sha256(buf) });
    const stored = (await this.backend.write(meta, buf)) || meta;
    this.files.set(meta.id, { meta: stored, buf });
    this._changed([meta.id]);
    return stored;
  }

  get(id) {
    return this.files.get(id) || null;
  }

  /** Archivos de una carpeta con ese nombre, el más nuevo primero (como lo vería DriveApp). */
  findByName(folderId, name) {
    const out = [];
    for (const f of this.files.values()) if (f.meta.folderId === folderId && f.meta.name === name) out.push(f);
    return out.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
  }

  inFolder(folderId) {
    const out = [];
    for (const f of this.files.values()) if (f.meta.folderId === folderId) out.push(f);
    return out.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
  }

  hasFolder(folderId) {
    for (const f of this.files.values()) if (f.meta.folderId === folderId) return true;
    return false;
  }

  listMeta() {
    return Array.from(this.files.values(), (f) => f.meta).sort((a, b) => a.id.localeCompare(b.id));
  }
}

/** Arma el store según la config: FILE_STORE_DIR (local), DynamoDB (Ownia) o nada (sin datos). */
function createFileStore(cfg, log) {
  if (cfg.FILE_STORE_DIR) return new FileStore(new DirBackend(cfg.FILE_STORE_DIR), { log });
  const table = (cfg.secrets || {}).DYNAMODB_TABLE;
  if (table) return new FileStore(new DynamoBackend(table, { log }), { log });
  return null;
}

module.exports = { FileStore, DirBackend, DynamoBackend, createFileStore, isValidId, CHUNK_BYTES };
