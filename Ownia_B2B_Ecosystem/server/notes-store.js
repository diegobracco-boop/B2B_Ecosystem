// Notas editables de las landings en Ownia (2026-10-26): los textos de las "Slides mensuales" del
// Hub (desafíos, highlights, business levers…), que el equipo edita en pantalla y comparte.
// Apps Script no tiene esto: es solo de Ownia.
//
// Una nota = (módulo, scope, campo) → { text, by, at }. scope agrupa (p.ej. "slides-2026-09" = el
// deck del mes) y cada campo se guarda por separado: dos personas editando slides distintas no se
// pisan. Backend en disco (local, FILE_STORE_DIR/_notes) o en la misma tabla DynamoDB del espejo
// (pk = notes#<módulo>, sk = <scope>#<campo>).
const fs = require('fs');
const path = require('path');

const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const SCOPE_RE = /^[a-z0-9-]{1,40}$/;
const FIELD_RE = /^[a-z0-9_-]{1,60}$/;
const MAX_TEXT = 8000;

function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }

function check(slug, scope, field) {
  if (!SLUG_RE.test(String(slug))) throw bad('módulo inválido');
  if (!SCOPE_RE.test(String(scope))) throw bad('scope inválido');
  if (field !== undefined && !FIELD_RE.test(String(field))) throw bad('campo inválido');
}

function cleanText(text) {
  if (typeof text !== 'string') throw bad('text tiene que ser un string');
  if (text.length > MAX_TEXT) throw bad(`text supera ${MAX_TEXT} caracteres`);
  return text;
}

// <dir>/<módulo>/<scope>.json = { campo: { text, by, at } }
class DirNotes {
  constructor(dir) { this.dir = path.resolve(dir); }
  _file(slug, scope) { return path.join(this.dir, slug, scope + '.json'); }
  async get(slug, scope) {
    check(slug, scope);
    const f = this._file(slug, scope);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  }
  async put(slug, scope, field, text, by) {
    check(slug, scope, field);
    const all = await this.get(slug, scope);
    all[field] = { text: cleanText(text), by: by || null, at: new Date().toISOString() };
    fs.mkdirSync(path.dirname(this._file(slug, scope)), { recursive: true });
    fs.writeFileSync(this._file(slug, scope), JSON.stringify(all, null, 1));
    return all[field];
  }
}

class DynamoNotes {
  constructor(tableName, opts = {}) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    this.table = tableName;
    this.doc = opts.client || DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
    this.cmd = require('@aws-sdk/lib-dynamodb');
  }
  async get(slug, scope) {
    check(slug, scope);
    const out = {};
    let ExclusiveStartKey;
    do {
      const r = await this.doc.send(new this.cmd.QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': `notes#${slug}`, ':p': `${scope}#` },
        ExclusiveStartKey,
      }));
      for (const i of r.Items || []) out[String(i.sk).slice(scope.length + 1)] = { text: i.text, by: i.by || null, at: i.at };
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }
  async put(slug, scope, field, text, by) {
    check(slug, scope, field);
    const item = { text: cleanText(text), by: by || null, at: new Date().toISOString() };
    await this.doc.send(new this.cmd.PutCommand({
      TableName: this.table,
      Item: { pk: `notes#${slug}`, sk: `${scope}#${field}`, ...item },
    }));
    return item;
  }
}

/** Según la config: disco (FILE_STORE_DIR/_notes, local) o DynamoDB (Ownia); sin ninguno, null. */
function createNotesStore(cfg) {
  if (cfg.FILE_STORE_DIR) return new DirNotes(path.join(cfg.FILE_STORE_DIR, '_notes'));
  const table = (cfg.secrets || {}).DYNAMODB_TABLE;
  if (table) return new DynamoNotes(table);
  return null;
}

module.exports = { DirNotes, DynamoNotes, createNotesStore, MAX_TEXT };
