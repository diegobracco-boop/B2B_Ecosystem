/* Daily Dashboard en Ownia — "⬇ Descargar Excel" (2026-11-04, Tiago).
 *
 * Botón en la barra de filtros de la solapa Daily (B2B2C). Abre un pop-up con mes, país y partner y baja un
 * .xlsx con la información transaccional diaria de B2B2C de esa selección:
 *  - "Resumen diario": un renglón por día del mes (hasta el último día con datos) con Órdenes, GB, NR y FVM, y Total.
 *  - "Detalle": las filas de actuals de daily_sync.py como las tiene cargadas la página (alias de partner aplicados, FVM
 *    de las filas RG según el switch COI Brasil; sin las filas con todo en 0): fecha, país, región del maestro de partners
 *    (HISPA / BR / MX/US…, no la región del Daily), partner, producto, canal, viaje, tipo de cuenta, tier, órdenes, GB, NR, FVM.
 *  - "Info": la selección, la fecha de datos y cómo leer los números.
 *
 * Datos: los mismos que ya cargó el Daily (_rawB2BC.actuals, con los alias de partner aplicados); no pide nada al
 * servidor. USD nominal: NO sigue el switch Organic (el pop-up avisa si la página está en Organic YES). Sigue los switches de la página: Partner TBD (b2bcRaw_) y COI Brasil (las filas
 * del país RG traen el ajuste COI Brasil cuando está en "Excluir"; con "Incluir" van en 0 y no se bajan).
 *
 * El .xlsx se arma acá mismo (Office Open XML + zip sin compresión): sin librerías ni CDN.
 * Lógica pura en window.DailyExcel (filterRows, dailySummary, buildWorkbook…), probada en test/daily-excel.test.js.
 */
(function (root) {
  'use strict';

  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var ALL = 'all';
  var RG = 'RG';

  // ── Datos ────────────────────────────────────────────────────────────────
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function monthOf(fecha) { return String(fecha || '').slice(0, 7); }
  function monthLabel(mes) { var m = /^(\d{4})-(\d{2})$/.exec(mes || ''); return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : mes; }
  function isZero(r) { return !num(r.orders) && !num(r.gross_bookings) && !num(r.net_revenues) && !num(r.fvm); }
  function uniqSorted(arr) { var s = {}; arr.forEach(function (x) { if (x) s[x] = 1; }); return Object.keys(s).sort(function (a, b) { return a.localeCompare(b); }); }

  function monthsOf(rows) { return uniqSorted(rows.map(function (r) { return monthOf(r.fecha); })).reverse(); }   // el más reciente primero
  function countriesOf(rows, mes) {
    return uniqSorted(rows.filter(function (r) { return (!mes || monthOf(r.fecha) === mes) && !isZero(r); }).map(function (r) { return r.pais; }));
  }
  function partnersOf(rows, mes, pais) {
    return uniqSorted(rows.filter(function (r) {
      return (!mes || monthOf(r.fecha) === mes) && (!pais || pais === ALL || r.pais === pais) && !isZero(r);
    }).map(function (r) { return r.partner; }));
  }

  // sel = { mes: 'AAAA-MM', pais: 'all' | país, partner: 'all' | partner }. Las filas con todo en 0 no aportan y no se bajan.
  function filterRows(rows, sel) {
    sel = sel || {};
    return rows.filter(function (r) {
      return monthOf(r.fecha) === sel.mes
        && (!sel.pais || sel.pais === ALL || r.pais === sel.pais)
        && (!sel.partner || sel.partner === ALL || r.partner === sel.partner)
        && !isZero(r);
    }).sort(function (a, b) {
      return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1
        : String(a.pais).localeCompare(String(b.pais)) || String(a.partner).localeCompare(String(b.partner))
        || String(a.productooriginal).localeCompare(String(b.productooriginal));
    });
  }

  function totals(rows) {
    var t = { orders: 0, gb: 0, nr: 0, fvm: 0 };
    rows.forEach(function (r) { t.orders += num(r.orders); t.gb += num(r.gross_bookings); t.nr += num(r.net_revenues); t.fvm += num(r.fvm); });
    return t;
  }

  // Un renglón por día del mes, del 1 al último día con datos (lastDate) o a fin de mes; los días sin filas van en 0.
  function dailySummary(rows, mes, lastDate) {
    var m = /^(\d{4})-(\d{2})$/.exec(mes || ''); if (!m) return [];
    var days = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
    var end = days;
    if (lastDate && monthOf(lastDate) === mes) end = +lastDate.slice(8, 10);
    else if (lastDate && lastDate < mes) end = 0;
    var by = {};
    rows.forEach(function (r) { (by[r.fecha] = by[r.fecha] || []).push(r); });
    var out = [];
    for (var d = 1; d <= end; d++) {
      var f = mes + '-' + (d < 10 ? '0' : '') + d;
      var t = totals(by[f] || []);
      t.fecha = f;
      out.push(t);
    }
    return out;
  }

  // ── XLSX (Office Open XML mínimo) ────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  // Excel: días desde 1899-12-30.
  function dateSerial(fecha) { var p = fecha.split('-'); return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30)) / 86400000); }

  // Estilos: 0 normal · 1 encabezado · 2 número #,##0 · 3 número en negrita · 4 fecha · 5 texto en negrita
  var S = { txt: 0, head: 1, n: 2, nb: 3, date: 4, b: 5 };
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>' +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF5626E9"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="3" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  // cells: [{v, t:'s'|'n'|'d', s}] ; sheet = {name, cols:[ancho], rows:[[cell]], freeze:bool, filter:'A1:M1'}
  function sheetXml(sh) {
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    if (sh.freeze) x += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    if (sh.cols && sh.cols.length) {
      x += '<cols>' + sh.cols.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>';
    }
    x += '<sheetData>';
    sh.rows.forEach(function (row, ri) {
      x += '<row r="' + (ri + 1) + '">';
      row.forEach(function (c, ci) {
        if (c == null || c.v == null || c.v === '') return;
        var ref = colName(ci) + (ri + 1), st = c.s ? ' s="' + c.s + '"' : '';
        if (c.t === 'n') x += '<c r="' + ref + '"' + st + '><v>' + num(c.v) + '</v></c>';
        else if (c.t === 'd') x += '<c r="' + ref + '"' + st + '><v>' + dateSerial(c.v) + '</v></c>';
        else x += '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + esc(c.v) + '</t></is></c>';
      });
      x += '</row>';
    });
    x += '</sheetData>';
    if (sh.filter) x += '<autoFilter ref="' + sh.filter + '"/>';
    return x + '</worksheet>';
  }

  function workbookFiles(sheets) {
    var files = [];
    files.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
      '</Types>']);
    files.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
    var filters = '';
    sheets.forEach(function (s, i) {
      if (s.filter) filters += '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + esc(s.name) + '\'!' + s.filter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2') + '</definedName>';
    });
    files.push(['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(function (s, i) { return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') +
      '</sheets>' + (filters ? '<definedNames>' + filters + '</definedNames>' : '') + '</workbook>']);
    files.push(['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>']);
    files.push(['xl/styles.xml', STYLES]);
    sheets.forEach(function (s, i) { files.push(['xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s)]); });
    return files;
  }

  // Zip sin compresión (método 0 "stored"): alcanza para Excel y no necesita librerías.
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function utf8(s) { return new TextEncoder().encode(s); }
  function zip(files) {
    var parts = [], central = [], offset = 0;
    function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
    function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }
    files.forEach(function (f) {
      var name = utf8(f[0]), data = utf8(f[1]), crc = crc32(data);
      // flag 0x0800 = nombres en UTF-8; fecha fija 1980-01-01 para que el archivo sea reproducible
      var common = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      var local = new Uint8Array([].concat(u32(0x04034b50), common));
      parts.push(local, name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += local.length + name.length + data.length;
    });
    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    var all = parts.concat(central, [end]);
    var out = new Uint8Array(all.reduce(function (a, b) { return a + b.length; }, 0)), p = 0;
    all.forEach(function (b) { out.set(b, p); p += b.length; });
    return out;
  }

  var DETAIL_COLS = [
    ['Fecha', 'fecha', 'd', 12], ['País', 'pais', 's', 16], ['Región partner', 'region', 's', 14], ['Partner', 'partner', 's', 28],
    ['Producto', 'productooriginal', 's', 18], ['Canal', 'channel', 's', 14], ['Viaje', 'viaje', 's', 12],
    ['Tipo de cuenta', 'account_type', 's', 14], ['Tier', 'tier', 's', 10],
    ['Órdenes', 'orders', 'n', 10], ['GB (USD)', 'gross_bookings', 'n', 14], ['NR (USD)', 'net_revenues', 'n', 14], ['FVM (USD)', 'fvm', 'n', 14]
  ];

  function selLabel(sel) {
    return {
      pais: !sel.pais || sel.pais === ALL ? 'Todos los países' : sel.pais,
      partner: !sel.partner || sel.partner === ALL ? 'Todos los partners' : sel.partner
    };
  }

  // opts = { rows (actuals), sel, meta: {last_actuals_date, generated_at}, coiExcl: bool, tbdExcl: bool }
  function buildSheets(opts) {
    var sel = opts.sel, meta = opts.meta || {};
    var rows = filterRows(opts.rows || [], sel);
    var days = dailySummary(rows, sel.mes, meta.last_actuals_date);
    var tot = totals(rows);
    var lbl = selLabel(sel);
    var H = function (t) { return { v: t, t: 's', s: S.head }; };

    var res = { name: 'Resumen diario', cols: [12, 12, 16, 16, 16], freeze: true, rows: [] };
    res.rows.push([H('Fecha'), H('Órdenes'), H('GB (USD)'), H('NR (USD)'), H('FVM (USD)')]);
    days.forEach(function (d) {
      res.rows.push([{ v: d.fecha, t: 'd', s: S.date }, { v: d.orders, t: 'n', s: S.n }, { v: d.gb, t: 'n', s: S.n }, { v: d.nr, t: 'n', s: S.n }, { v: d.fvm, t: 'n', s: S.n }]);
    });
    res.rows.push([{ v: 'Total', t: 's', s: S.b }, { v: tot.orders, t: 'n', s: S.nb }, { v: tot.gb, t: 'n', s: S.nb }, { v: tot.nr, t: 'n', s: S.nb }, { v: tot.fvm, t: 'n', s: S.nb }]);

    var det = { name: 'Detalle', cols: DETAIL_COLS.map(function (c) { return c[3]; }), freeze: true, rows: [] };
    det.rows.push(DETAIL_COLS.map(function (c) { return H(c[0]); }));
    rows.forEach(function (r) {
      det.rows.push(DETAIL_COLS.map(function (c) {
        var v = r[c[1]];
        if (c[2] === 'n') return { v: num(v), t: 'n', s: S.n };
        if (c[2] === 'd') return { v: v, t: 'd', s: S.date };
        return { v: c[1] === 'pais' && v === RG ? 'RG (ajuste COI Brasil)' : v, t: 's' };
      }));
    });
    det.filter = 'A1:' + colName(DETAIL_COLS.length - 1) + Math.max(1, det.rows.length);

    var info = { name: 'Info', cols: [24, 90], rows: [] };
    var I = function (k, v) { info.rows.push([{ v: k, t: 's', s: S.b }, { v: v, t: 's' }]); };
    info.rows.push([{ v: 'Daily Dashboard · B2B2C — información transaccional diaria', t: 's', s: S.b }]);
    info.rows.push([]);
    I('Mes', monthLabel(sel.mes));
    I('País', lbl.pais);
    I('Partner', lbl.partner);
    I('Datos al', meta.last_actuals_date || '—');
    I('Generado por el pipeline', meta.generated_at || '—');
    I('Filas de detalle', String(rows.length));
    info.rows.push([]);
    I('Moneda', 'USD nominal (sin Organic): los montos tal cual los publica daily_sync.py.');
    I('GB / NR / FVM', 'Gross Bookings, Net Revenue y FVM de actuals B2B2C (fecha de compra), sumados por día en "Resumen diario".');
    I('COI Brasil', opts.coiExcl
      ? 'Excluir (como la página): las filas del país "RG (ajuste COI Brasil)" restan el COI y el efecto financiero de Brasil del FVM; Brasil conserva su FVM completo.'
      : 'Incluir (como la página): FVM completo, sin las filas de ajuste RG.');
    I('Partner TBD', opts.tbdExcl ? 'Excluido (como la página).' : 'Incluido (como la página).');
    return [res, det, info];
  }

  function buildWorkbook(opts) { return zip(workbookFiles(buildSheets(opts))); }

  function slug(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
  }
  function fileName(sel) {
    var p = !sel.pais || sel.pais === ALL ? 'todos-paises' : slug(sel.pais);
    var q = !sel.partner || sel.partner === ALL ? 'todos-partners' : slug(sel.partner);
    return 'daily_b2b2c_' + sel.mes + '_' + p + '_' + q + '.xlsx';
  }

  var api = {
    monthsOf: monthsOf, countriesOf: countriesOf, partnersOf: partnersOf, filterRows: filterRows,
    totals: totals, dailySummary: dailySummary, buildSheets: buildSheets, buildWorkbook: buildWorkbook,
    fileName: fileName, monthLabel: monthLabel, crc32: crc32, ALL: ALL
  };
  root.DailyExcel = api;

  // ── UI (solo en la página del Daily) ─────────────────────────────────────
  if (typeof document === 'undefined' || !root.location) return;
  if (/[?&](flowdeck=1|embed=|weeklyembed=)/.test(root.location.search)) return;   // vistas embebidas: sin botón

  var CSS = [
    '.dx-btn{display:flex;align-items:center;gap:6px;margin-left:auto;background:var(--primary,#5626e9);color:#fff;border:0;border-radius:8px;padding:0 12px;height:30px;font:600 11px var(--font,sans-serif);cursor:pointer;white-space:nowrap}',
    '.dx-btn:hover{filter:brightness(1.1)}',
    '.dx-back{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center}',
    '.dx-pop{background:var(--surface,#fff);color:var(--text,#111);border:1px solid var(--border,#ddd);border-radius:14px;padding:22px 24px;width:min(380px,92vw);box-shadow:0 20px 50px rgba(0,0,0,.35);font-family:var(--font,sans-serif)}',
    '.dx-pop h3{margin:0 0 4px;font-size:16px;font-weight:600}',
    '.dx-pop p{margin:0 0 16px;font-size:12px;color:var(--text-3,#666)}',
    '.dx-pop label{display:block;font-size:11px;font-weight:600;color:var(--text-2,#333);margin:12px 0 4px}',
    '.dx-pop select{width:100%;height:34px;border-radius:8px;border:1px solid var(--border,#ccc);background:var(--elevated,#fff);color:var(--text,#111);padding:0 8px;font:13px var(--font,sans-serif)}',
    '.dx-org{margin-top:12px;font-size:11px;color:var(--warning,#b58100)}',
    '.dx-sum{margin-top:14px;font-size:12px;color:var(--text-2,#333);min-height:16px}',
    '.dx-act{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}',
    '.dx-act button{height:34px;border-radius:8px;padding:0 16px;font:600 12px var(--font,sans-serif);cursor:pointer}',
    '.dx-cancel{background:transparent;border:1px solid var(--border,#ccc);color:var(--text,#111)}',
    '.dx-go{background:var(--primary,#5626e9);border:0;color:#fff;display:inline-flex;align-items:center;gap:6px}',
    '.dx-go:disabled{opacity:.5;cursor:default}'
  ].join('\n');

  function rawRows() {
    var raw = typeof root.b2bcRaw_ === 'function' ? root.b2bcRaw_() : root._rawB2BC;
    return raw && Array.isArray(raw.actuals) ? raw.actuals : null;
  }
  function opt(v, t, cur) { var o = document.createElement('option'); o.value = v; o.textContent = t; if (v === cur) o.selected = true; return o; }
  function fmt(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

  var ICON = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

  function otherFilters() {
    var p = document.getElementById('sel-product'), a = document.getElementById('sel-account');
    return (p && p.value && p.value !== 'all') || (a && a.value && a.value !== 'all');
  }

  function openPopup() {
    if (document.querySelector('.dx-back')) return;   // ya abierto
    var rows = rawRows();
    if (!rows) { alert('El Daily todavía está cargando los datos. Probá de nuevo en unos segundos.'); return; }
    var back = document.createElement('div');
    back.className = 'dx-back';
    back.innerHTML = '<div class="dx-pop" role="dialog" aria-modal="true" aria-labelledby="dx-t">' +
      '<h3 id="dx-t">Descargar Excel · B2B2C</h3><p>Información transaccional diaria (GB, NR y FVM en USD nominal).</p>' +
      '<label for="dx-mes">Mes</label><select id="dx-mes"></select>' +
      '<label for="dx-pais">País</label><select id="dx-pais"></select>' +
      '<label for="dx-partner">Partner</label><select id="dx-partner"></select>' +
      (otherFilters() ? '<div class="dx-org">El Excel no aplica los filtros de producto ni Existing / New que tenés en la página: baja todos.</div>' : '') +
      (root._dlOrganic ? '<div class="dx-org">La página está en Organic YES: el Excel baja USD nominal (Organic NO), así que en países con moneda local puede no coincidir con lo que ves en pantalla.</div>' : '') +
      '<div class="dx-sum" id="dx-sum"></div>' +
      '<div class="dx-act"><button type="button" class="dx-cancel">Cancelar</button><button type="button" class="dx-go">' + ICON + ' Descargar</button></div></div>';
    document.body.appendChild(back);
    var $ = function (id) { return back.querySelector('#' + id); };
    var sMes = $('dx-mes'), sPais = $('dx-pais'), sPartner = $('dx-partner'), sum = $('dx-sum'), go = back.querySelector('.dx-go');

    // Arranca con lo que ya está filtrado en la página si es un solo país / un partner.
    var pagePais = Array.isArray(root._selPaises) && root._selPaises.length === 1 ? root._selPaises[0] : ALL;
    var pp = document.getElementById('sel-partner'), pagePartner = pp && pp.value && pp.value !== 'all' ? pp.value : ALL;
    var lastMes = root._rawB2BC && root._rawB2BC.meta ? monthOf(root._rawB2BC.meta.last_actuals_date) : '';

    monthsOf(rows).forEach(function (m) { sMes.appendChild(opt(m, monthLabel(m).replace(/^./, function (c) { return c.toUpperCase(); }), lastMes)); });

    function fillPais() {
      var cur = sPais.value || pagePais;
      sPais.innerHTML = '';
      sPais.appendChild(opt(ALL, 'Todos los países', cur));
      countriesOf(rows, sMes.value).forEach(function (p) { sPais.appendChild(opt(p, p === RG ? 'RG (ajuste COI Brasil)' : p, cur)); });
      var ok = Array.prototype.some.call(sPais.options, function (o) { return o.value === cur; });
      sPais.value = ok ? cur : ALL;
    }
    function fillPartner() {
      var cur = sPartner.value || pagePartner;
      sPartner.innerHTML = '';
      sPartner.appendChild(opt(ALL, 'Todos los partners', cur));
      partnersOf(rows, sMes.value, sPais.value).forEach(function (p) { sPartner.appendChild(opt(p, p, cur)); });
      var ok = Array.prototype.some.call(sPartner.options, function (o) { return o.value === cur; });
      sPartner.value = ok ? cur : ALL;   // el partner elegido no está en ese país / mes: vuelve a "Todos"
    }
    function sel() { return { mes: sMes.value, pais: sPais.value, partner: sPartner.value }; }
    function preview() {
      var f = filterRows(rows, sel()), t = totals(f);
      go.disabled = !f.length;
      sum.textContent = f.length ? f.length.toLocaleString('en-US') + ' filas · GB ' + fmt(t.gb) + ' · NR ' + fmt(t.nr) + ' · FVM ' + fmt(t.fvm) : 'Sin datos para esta selección.';
    }
    fillPais(); fillPartner(); preview();
    sMes.onchange = function () { fillPais(); fillPartner(); preview(); };
    sPais.onchange = function () { fillPartner(); preview(); };
    sPartner.onchange = preview;

    function close() { document.removeEventListener('keydown', onKey); back.remove(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    back.querySelector('.dx-cancel').onclick = close;
    go.onclick = function () {
      var s = sel();
      var bytes = buildWorkbook({
        rows: rows, sel: s, meta: (root._rawB2BC && root._rawB2BC.meta) || {},
        coiExcl: root._exCoiBr !== false, tbdExcl: !!root._b2bcExclTBD
      });
      var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName(s);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      close();
    };
    sMes.focus();
  }

  function mount() {
    var fbar = document.querySelector('#view-daily .fbar:not(#b2b-fbar)');
    if (!fbar || document.getElementById('dx-btn')) return !!fbar;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'dx-btn'; b.className = 'dx-btn';
    b.title = 'Bajar a Excel la información diaria de B2B2C (GB, NR, FVM) por mes, país y partner';
    b.innerHTML = ICON + 'Descargar Excel';
    b.onclick = openPopup;
    fbar.appendChild(b);
    return true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})(typeof window !== 'undefined' ? window : this);
