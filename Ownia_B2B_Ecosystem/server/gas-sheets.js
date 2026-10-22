// Shim de SpreadsheetApp (solo lectura) sobre el file-store. El espejo exporta cada Google
// Sheet del manifest como .xlsx (mismo id y fecha de modificación que en Drive) y acá se lee
// con el unzip/XML propios: los módulos piden la planilla por el mismo id que en Apps Script.
//
// Cubre lo que usan las landings: openById → getSheetByName/getSheets → getRange (fila/col o
// A1) / getDataRange → getValues / getDisplayValues, getLastRow/getLastColumn. getValues
// devuelve lo mismo que GAS: números, strings, booleanos, Date (celdas con formato fecha, en la
// zona horaria del proyecto) y '' para vacías. Escribir tira ServicioNoMigrado.
const { ServicioNoMigrado, unzipEntries } = require('./gas-services');
const { parseXml } = require('./gas-xml');

function notFound() {
  const e = new Error(
    'Unexpected error while getting the method or property openById on object SpreadsheetApp.'
  );
  e.name = 'Exception';
  return e;
}

// ---------- xlsx ----------

const kids = (n, local) => n.children.filter((c) => c.text === undefined && (!local || c.local === local));
const kid = (n, local) => kids(n, local)[0] || null;
const text = (n) => (n ? n.children.map((c) => (c.text !== undefined ? c.text : c.local === 'rPh' ? '' : text(c))).join('') : '');
const attr = (n, local) => {
  const a = n && n.attrs.find((x) => x.local === local);
  return a ? a.value : null;
};

// Formatos de fecha predefinidos de Excel (14–22, 45–47).
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormat(code) {
  const s = String(code)
    .replace(/"[^"]*"/g, '')     // literales
    .replace(/\\./g, '')         // caracteres escapados
    .replace(/\[[^\]]*\]/g, ''); // colores, condiciones, [$-locale]
  return /[dmyhs]/i.test(s) && !/^general$/i.test(s.trim());
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseRef(ref) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!m) throw Object.assign(new Error(`Referencia inválida: ${ref}`), { name: 'Exception' });
  return { row: Number(m[2]), col: colIndex(m[1]) };
}

/** { sheets: [{ name, cells: Map("r,c" → {v, date, display}), lastRow, lastCol }] } */
function parseWorkbook(buf) {
  const files = new Map(unzipEntries(buf).map((e) => [e.name.replace(/^\/+/, ''), e.data]));
  const xml = (p) => (files.has(p) ? parseXml(files.get(p).toString('utf8')) : null);

  const shared = [];
  const sst = xml('xl/sharedStrings.xml');
  if (sst) for (const si of kids(sst, 'si')) shared.push(text(si));

  const dateStyles = new Set();
  const styles = xml('xl/styles.xml');
  if (styles) {
    const custom = new Map();
    const numFmts = kid(styles, 'numFmts');
    if (numFmts) for (const f of kids(numFmts, 'numFmt')) custom.set(Number(attr(f, 'numFmtId')), attr(f, 'formatCode'));
    const xfs = kid(styles, 'cellXfs');
    if (xfs) {
      kids(xfs, 'xf').forEach((xf, i) => {
        const id = Number(attr(xf, 'numFmtId') || 0);
        if (BUILTIN_DATE.has(id) || (custom.has(id) && isDateFormat(custom.get(id)))) dateStyles.add(i);
      });
    }
  }

  const wb = xml('xl/workbook.xml');
  const rels = xml('xl/_rels/workbook.xml.rels');
  const target = new Map();
  if (rels) for (const r of kids(rels, 'Relationship')) target.set(attr(r, 'Id'), attr(r, 'Target'));
  const sheetsNode = wb && kid(wb, 'sheets');
  const sheets = [];
  for (const s of sheetsNode ? kids(sheetsNode, 'sheet') : []) {
    let t = target.get(attr(s, 'id')) || '';
    t = t.startsWith('/') ? t.slice(1) : `xl/${t}`;
    const ws = xml(t);
    const cells = new Map();
    let lastRow = 0;
    let lastCol = 0;
    const data = ws && kid(ws, 'sheetData');
    for (const row of data ? kids(data, 'row') : []) {
      for (const c of kids(row, 'c')) {
        const { row: r, col } = parseRef(attr(c, 'r'));
        const type = attr(c, 't') || 'n';
        const vNode = kid(c, 'v');
        let v;
        let date = false;
        if (type === 's') v = shared[Number(text(vNode))] ?? '';
        else if (type === 'inlineStr') v = text(kid(c, 'is'));
        else if (type === 'str' || type === 'e') v = text(vNode);
        else if (type === 'b') v = text(vNode) === '1';
        else if (vNode) {
          v = Number(text(vNode));
          date = dateStyles.has(Number(attr(c, 's') || 0));
        } else continue; // celda solo con formato
        if (v === '') continue;
        cells.set(`${r},${col}`, { v, date });
        if (r > lastRow) lastRow = r;
        if (col > lastCol) lastCol = col;
      }
    }
    sheets.push({ name: attr(s, 'name'), cells, lastRow, lastCol });
  }
  return { sheets };
}

// Serial de Excel (días desde 1899-12-30, hora de pared en la zona de la planilla) → epoch ms.
function serialToMs(serial, timeZone) {
  const wall = Math.round((serial - 25569) * 86400000);
  const offsetAt = (t) => {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t))) p[x.type] = x.value;
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
  };
  let t = wall - offsetAt(wall);
  const o2 = offsetAt(t);
  if (wall - o2 !== t) t = wall - o2;
  return t;
}

// ---------- API estilo GAS ----------

const WRITE = ['setValue', 'setValues', 'setFormula', 'setFormulas', 'clear', 'clearContent', 'appendRow', 'insertRows',
  'insertSheet', 'deleteRow', 'deleteRows', 'deleteSheet', 'setName', 'setBackground', 'setNumberFormat', 'copyTo', 'sort'];

function guard(obj, kind) {
  for (const m of WRITE) obj[m] = () => { throw new ServicioNoMigrado(kind, m); };
  return obj;
}

/**
 * @param {() => FileStore|null} getStore
 * @param {(ms:number) => Date} makeDate  crea el Date en el realm del módulo
 * @param {string} timeZone               zona de las fechas de la planilla (la del proyecto)
 */
function makeSpreadsheetApp(getStore, makeDate, timeZone) {
  const parsed = new WeakMap(); // buf del store → workbook (se reparsea solo si el espejo subió otro)

  const store = (member) => {
    const s = getStore();
    if (!s) throw new ServicioNoMigrado('SpreadsheetApp', member);
    return s;
  };

  function cellValue(sheet, r, c) {
    const cell = sheet.cells.get(`${r},${c}`);
    if (!cell) return '';
    return cell.date ? makeDate(serialToMs(cell.v, timeZone)) : cell.v;
  }

  function rangeObj(sheet, row, col, numRows, numCols) {
    if (!(row >= 1 && col >= 1 && numRows >= 1 && numCols >= 1)) {
      throw Object.assign(new Error('The coordinates of the range are outside the dimensions of the sheet.'), { name: 'Exception' });
    }
    const values = () => {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const line = [];
        for (let c = 0; c < numCols; c++) line.push(cellValue(sheet, row + r, col + c));
        out.push(line);
      }
      return out;
    };
    return guard({
      getValues: values,
      getValue: () => cellValue(sheet, row, col),
      getDisplayValues: () => values().map((l) => l.map((v) => (v === '' ? '' : String(v)))),
      getDisplayValue: () => { const v = cellValue(sheet, row, col); return v === '' ? '' : String(v); },
      getRow: () => row,
      getColumn: () => col,
      getNumRows: () => numRows,
      getNumColumns: () => numCols,
      getLastRow: () => row + numRows - 1,
      getLastColumn: () => col + numCols - 1,
    }, 'Range');
  }

  function sheetObj(sheet) {
    return guard({
      getName: () => sheet.name,
      getLastRow: () => sheet.lastRow,
      getLastColumn: () => sheet.lastCol,
      getMaxRows: () => sheet.lastRow,
      getMaxColumns: () => sheet.lastCol,
      getDataRange: () => rangeObj(sheet, 1, 1, Math.max(1, sheet.lastRow), Math.max(1, sheet.lastCol)),
      getRange: (a, b, c, d) => {
        if (typeof a === 'string') {
          const [from, to] = a.replace(/^.*!/, '').split(':');
          const p = parseRef(from);
          const q = to ? parseRef(to) : p;
          return rangeObj(sheet, p.row, p.col, q.row - p.row + 1, q.col - p.col + 1);
        }
        return rangeObj(sheet, Number(a), Number(b), c == null ? 1 : Number(c), d == null ? 1 : Number(d));
      },
    }, 'Sheet');
  }

  function spreadsheetObj(meta, wb) {
    return guard({
      getId: () => meta.id,
      getName: () => meta.name,
      getUrl: () => `https://docs.google.com/spreadsheets/d/${meta.id}/edit`,
      getSheets: () => wb.sheets.map(sheetObj),
      getSheetByName: (name) => {
        const s = wb.sheets.find((x) => x.name === String(name));
        return s ? sheetObj(s) : null;
      },
      getSheetId: () => 0,
    }, 'Spreadsheet');
  }

  const app = {
    openById: (id) => {
      const entry = store('openById').get(String(id));
      if (!entry) throw notFound();
      let wb = parsed.get(entry.buf);
      if (!wb) {
        wb = parseWorkbook(entry.buf);
        parsed.set(entry.buf, wb);
      }
      return spreadsheetObj(entry.meta, wb);
    },
  };
  for (const m of ['openByUrl', 'getActive', 'getActiveSpreadsheet', 'getActiveSheet', 'create', 'flush', 'getUi']) {
    app[m] = () => { throw new ServicioNoMigrado('SpreadsheetApp', m); };
  }
  return app;
}

module.exports = { makeSpreadsheetApp, parseWorkbook, serialToMs, isDateFormat };
