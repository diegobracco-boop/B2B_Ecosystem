// Datos espejados de Drive: ruta /ingest, file-store, shim de DriveApp, unzip y XmlService.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createApp } = require('../server/index');
const { FileStore, DirBackend, DynamoBackend, CHUNK_BYTES } = require('../server/file-store');
const { unzipEntries } = require('../server/gas-services');
const { parseXml, makeXmlService } = require('../server/gas-xml');

const BASE = '/b2b-ecosystem';
const FIXTURES = path.join(__dirname, 'fixtures');
const TOKEN = 'token-de-prueba';
const DATA = { slug: 'data', dir: 'Data_Module', title: 'Data', desc: 'x', ownia: true, gasUrl: '' };
const USER = { 'x-test-email': 'ana@despegar.com' };
// Allowlist de /ingest para el módulo de prueba (en producción: server/drive-manifest.json).
const MANIFEST = {
  modules: {
    data: {
      files: { jsonFile000000000001: 'json', fxFile00000000000001: 'xlsx' },
      folders: { folder00000000000001: ['revenue_gd.json'] },
    },
  },
};

let server;
let app;
let storeDir;

// Zip mínimo (deflate) — mismo formato que un xlsx.
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  const n = Object.keys(files).length;
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(n, 8); eocd.writeUInt16LE(n, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XLSX = makeZip({
  'xl/': '',
  'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${NS}"><si><t>pais</t></si><si><t>Brasil &amp; Cía</t></si></sst>`,
  'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="${NS}" xmlns:r="http://x/r"><sheetData>` +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>dato</t></is></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>5.25</v></c></row></sheetData></worksheet>',
});

function request(method, urlPath, { body, headers } = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const put = (id, content, headers = {}) =>
  request('PUT', `${BASE}/ingest/files/${id}`, {
    body: content,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Updated-At': '2026-10-20T12:00:00.000Z', 'Content-Type': 'application/json', ...headers },
  });

const run = async (fn, args = []) => {
  const r = await request('POST', `${BASE}/api/data/${fn}`, {
    body: JSON.stringify({ args }),
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'google.script.run', ...USER },
  });
  return { status: r.status, ...JSON.parse(r.text) };
};

before(async () => {
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownia-store-'));
  app = createApp({
    GAS_ROOT: FIXTURES, BASE_PATH: BASE, modules: [DATA], secrets: {}, TRUSTED_IDENTITY_HEADER: 'x-test-email',
    FILE_STORE_DIR: storeDir, INGEST_TOKEN: TOKEN, FILE_STORE_POLL_MS: 0, manifest: MANIFEST,
  });
  await app.startData();
  server = await new Promise((resolve) => { const s = http.createServer(app.handler).listen(0, '127.0.0.1', () => resolve(s)); });
});

after(() => {
  server.close();
  app.fileStore.stop();
  fs.rmSync(storeDir, { recursive: true, force: true });
});

test('ingest: sin token o con token incorrecto → 401; con token, sube y lista', async () => {
  assert.equal((await request('GET', `${BASE}/ingest/files`)).status, 401);
  assert.equal((await put('jsonFile000000000001', '{}', { Authorization: 'Bearer otro' })).status, 401);

  const r = await put('jsonFile000000000001', JSON.stringify({ v: 1 }), { 'X-File-Name': encodeURIComponent('_actuals gestional.json') });
  assert.equal(r.status, 200, r.text);
  const meta = JSON.parse(r.text).file;
  assert.equal(meta.name, '_actuals gestional.json');
  assert.equal(meta.updatedAt, Date.parse('2026-10-20T12:00:00.000Z'));

  const list = JSON.parse((await request('GET', `${BASE}/ingest/files`, { headers: { Authorization: `Bearer ${TOKEN}` } })).text);
  assert.deepEqual(list.files.map((f) => f.id), ['jsonFile000000000001']);
});

test('ingest: id inválido, fecha inválida o futura, nombre mal codificado y método incorrecto', async () => {
  assert.equal((await put('..%2F..%2Fetc', '{}')).status, 400);
  assert.equal((await put('jsonFile000000000001', '{}', { 'X-Updated-At': 'ayer' })).status, 400);
  assert.equal((await put('jsonFile000000000001', '{}', { 'X-Updated-At': '2099-01-01T00:00:00Z' })).status, 400);
  assert.equal((await put('jsonFile000000000001', '{}', { 'X-File-Name': '%E0%A4%A' })).status, 400);
  const r = await request('POST', `${BASE}/ingest/files/jsonFile000000000001`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 405);
});

test('ingest: solo archivos del manifest (un token no alcanza para pisar otro id)', async () => {
  const r = await put('otroArchivo000000001', '{}');
  assert.equal(r.status, 403);
  assert.match(r.text, /drive-manifest/);
  const r2 = await put('otroArchivo000000001', '{}', { 'X-Folder-Id': 'folder00000000000001', 'X-File-Name': 'otro.json' });
  assert.equal(r2.status, 403, 'en la carpeta, solo con el nombre del manifest');
});

test('ingest: acepta el cuerpo comprimido con gzip', async () => {
  const r = await put('folderJson0000000001', zlib.gzipSync(JSON.stringify({ rows: [1, 2] })), {
    'Content-Encoding': 'gzip', 'X-File-Name': 'revenue_gd.json', 'X-Folder-Id': 'folder00000000000001',
  });
  assert.equal(r.status, 200, r.text);
});

test('DriveApp: getFileById, getLastUpdated (Date del módulo) y getFolderById().getFilesByName', async () => {
  assert.deepEqual((await run('leerJson')).result, { v: 1 });
  const f = (await run('fechaJson')).result;
  assert.equal(f.t, Date.parse('2026-10-20T12:00:00.000Z'));
  assert.equal(f.esDate, true, 'instanceof Date dentro del módulo');
  assert.deepEqual((await run('porNombre', ['revenue_gd.json'])).result, { rows: [1, 2] });
  assert.equal((await run('porNombre', ['otro.json'])).result, null);
});

test('DriveApp: id inexistente da el mismo error que GAS; escribir no está permitido', async () => {
  assert.match((await run('inexistente')).result, /No item with the given ID could be found/);
  const r = await run('escribir');
  assert.equal(r.status, 500);
  assert.equal(r.name, 'ServicioNoMigrado');
});

test('una versión nueva del archivo recarga el módulo (los globales memorizados no quedan viejos)', async () => {
  assert.deepEqual((await run('leerJson')).result, { v: 1 });
  await put('jsonFile000000000001', JSON.stringify({ v: 2 }), { 'X-Updated-At': '2026-10-21T08:00:00.000Z' });
  assert.deepEqual((await run('leerJson')).result, { v: 2 });
});

test('xlsx de TC: unzip + XmlService como readFxTable_', async () => {
  const r = await put('fxFile00000000000001', XLSX, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'X-File-Name': 'tc_plana_flat.xlsx' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual((await run('leerXlsx')).result, [{ A: 'pais', B: '' }, { A: 'Brasil & Cía', B: '5.25' }]);
});

test('file-store: otra instancia ve la subida en el próximo refresh', async () => {
  const other = new FileStore(new DirBackend(storeDir));
  await other.refresh();
  assert.equal(JSON.parse(other.get('jsonFile000000000001').buf.toString()).v, 2);
  assert.equal(other.findByName('folder00000000000001', 'revenue_gd.json').length, 1);
});

test('unzip: rechaza lo que no es zip', () => {
  assert.throws(() => unzipEntries(Buffer.from('no soy un zip, pero tengo más de veintidós bytes')), /no es un zip/);
  assert.deepEqual(unzipEntries(XLSX).map((e) => e.name), ['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
});

test('XmlService: namespaces, atributos, entidades, CDATA y errores', () => {
  const X = makeXmlService();
  const root = X.parse('<a:r xmlns:a="u:a" xmlns="u:d" id="7"><b>x &lt; <![CDATA[<y>]]></b><a:c/><!-- n --></a:r>').getRootElement();
  assert.equal(root.getName(), 'r');
  assert.equal(root.getNamespace().getURI(), 'u:a');
  assert.equal(root.getAttribute('id').getValue(), '7');
  assert.equal(root.getChild('b'), null, 'sin namespace no matchea un elemento con namespace por defecto');
  assert.equal(root.getChild('b', X.getNamespace('u:d')).getText(), 'x < <y>');
  assert.equal(root.getChildren('c', root.getNamespace()).length, 1);
  assert.equal(root.getChildren().length, 2);
  assert.throws(() => parseXml('<a><b></a>'), /cierre inesperado/);
  assert.throws(() => parseXml('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>'), /DTD interno/);
  assert.throws(() => parseXml('<a/><b/>'), /único elemento raíz/);
});

test('file-store: un refresh que falla a mitad no aplica nada; el siguiente aplica todo y avisa', async () => {
  const metas = [
    { id: 'aaaaaaaaaaaaaaaaaaa1', name: 'a', updatedAt: 1, sha256: 'a1' },
    { id: 'bbbbbbbbbbbbbbbbbbb1', name: 'b', updatedAt: 1, sha256: 'b1' },
  ];
  let falla = true;
  const backend = {
    list: async () => metas,
    read: async (m) => { if (m.id.startsWith('b') && falla) throw new Error('timeout'); return Buffer.from(m.sha256); },
  };
  const store = new FileStore(backend);
  let avisos = 0;
  store.onChange(() => avisos++);
  await assert.rejects(store.refresh(), /timeout/);
  assert.equal(store.get('aaaaaaaaaaaaaaaaaaa1'), null, 'no quedó nada aplicado a medias');
  assert.equal(avisos, 0);
  assert.match(store.lastError, /timeout/);
  falla = false;
  assert.equal((await store.refresh()).length, 2);
  assert.equal(avisos, 1);
  assert.equal(store.lastError, null);
});

// DynamoDB en memoria: entiende los comandos que usa DynamoBackend.
function fakeDynamo() {
  const items = new Map();
  const k = (pk, sk) => pk + '|' + sk;
  return {
    items,
    send: async (cmd) => {
      const n = cmd.constructor.name;
      const i = cmd.input;
      if (n === 'QueryCommand') {
        const pk = i.ExpressionAttributeValues[':pk'];
        return { Items: [...items.values()].filter((x) => x.pk === pk).map((x) => ({ ...x })) };
      }
      if (n === 'GetCommand') return { Item: items.get(k(i.Key.pk, i.Key.sk)) };
      if (n === 'PutCommand') {
        if (Buffer.byteLength(JSON.stringify(i.Item)) > 400000) throw new Error('Item size has exceeded the maximum allowed size');
        items.set(k(i.Item.pk, i.Item.sk), i.Item);
        return {};
      }
      if (n === 'BatchWriteCommand') {
        const reqs = Object.values(i.RequestItems)[0];
        assert.ok(reqs.length <= 25, 'BatchWrite de a 25');
        for (const r of reqs) {
          if (r.PutRequest) {
            assert.ok(r.PutRequest.Item.data.length <= 400000, 'pedazo < 400 KB');
            items.set(k(r.PutRequest.Item.pk, r.PutRequest.Item.sk), r.PutRequest.Item);
          } else items.delete(k(r.DeleteRequest.Key.pk, r.DeleteRequest.Key.sk));
        }
        return {};
      }
      throw new Error('comando no esperado ' + n);
    },
  };
}

test('DynamoBackend: archivo grande en pedazos de <400 KB, puntero al final y lectura verificada', async () => {
  const client = fakeDynamo();
  const store = new FileStore(new DynamoBackend('tabla', { client }));
  // Contenido poco comprimible (~1,5 MB gzip) para forzar varios pedazos.
  const big = require('crypto').randomBytes(1500000);
  const meta = await store.put({ id: 'jsonFile000000000001', name: 'x.json', updatedAt: 5 }, big);
  assert.ok(meta.chunks > 1 && meta.chunks <= Math.ceil(1600000 / CHUNK_BYTES), `pedazos: ${meta.chunks}`);

  const otra = new FileStore(new DynamoBackend('tabla', { client }));
  await otra.refresh();
  assert.ok(otra.get('jsonFile000000000001').buf.equals(big));

  // Puntero a una versión a la que le falta un pedazo → falla explícito, no datos truncados.
  client.items.delete(`mirror_blob#jsonFile000000000001#${meta.sha256}|c#0000`);
  const tercera = new FileStore(new DynamoBackend('tabla', { client }));
  await assert.rejects(tercera.refresh(), /pedazos/);
});
