// ══════════════════════════════════════════════════════════════════════════
//  Slides Cierre de Mes — export a Google Slides con objetos NATIVOS (editables)
// ══════════════════════════════════════════════════════════════════════════
// 2026-09-25 (pedido de Diego): los GRÁFICOS (columnas de Evolutivos, waterfall del Bridge)
// se construyen con formas nativas de Slides, "como si fuesen armados a mano" (editables);
// las TABLAS van como imagen (captura html2canvas, igual que antes). Header, panel de
// Highlights y divisores también son nativos. El cliente (dashboard.html, _cierreExportSlides) manda una
// slide por llamada — así ninguna ejecución se acerca al límite de 6 min de Apps Script —
// con el "spec" del gráfico (datos de Chart.js) y la imagen de la tabla. Si una slide nativa falla, el cliente la manda como imagen
// (cierreDeckAddImageSlide) y el deck nunca queda roto.
//
// Construcción nativa: servicio avanzado "Slides" (Slides API v1, habilitado en
// appsscript.json) → UN batchUpdate por slide (atómico). Las imágenes (tablas) se insertan
// DESPUÉS con SlidesApp (insertImage con blob): la Slides API solo acepta imágenes por URL.
//
// Layout (tomado del deck "V2" armado a mano por Diego): página 720x405 pt; header con
// título violeta #5626E9 20pt bold, isotipo de Despegar (10 barras #5A1FF2) arriba a la
// derecha y línea separadora #5A1FF2 a todo el ancho; contenido debajo de la línea.
//
// Nombres SIN "_" final a propósito: google.script.run no puede invocar funciones
// "privadas" (ver nota en buildCierreSlidesDeck / historial 2026-09-12).

var CD_VIOLET = '#5626E9';
var CD_BAR    = '#5A1FF2';
var CD_TXT    = '#1F2328';
var CD_MUTED  = '#57606A';
// largos relativos de las 10 barras del isotipo (medidos del ejemplo, en EMU)
var CD_LOGO_W = [472440, 563880, 640080, 701040, 739140, 762000, 746760, 716280, 670560, 609600];
// Slides pone un margen interno FIJO de 0,1" (7,2pt) por lado en los cuadros de texto y la API
// no permite cambiarlo; las etiquetas de los gráficos lo compensan (ver _cdText_ exact).
var CD_INSET = 7.2;

// ── Endpoints (google.script.run) ─────────────────────────────────────────

// Crea la presentación con la carátula. Devuelve id/url y tamaño de página (pt).
function cierreDeckStart(meta) {
  meta = meta || {};
  var pres = SlidesApp.create('Cierre ' + (meta.mesLbl || '') + ' — ' +
                              new Date().toISOString().slice(0, 16).replace('T', ' '));
  var w = pres.getPageWidth(), h = pres.getPageHeight();
  var def = pres.getSlides()[0];
  var title = pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
  title.insertTextBox('Cierre de Mes', 40, h / 2 - 60, w - 80, 50)
       .getText().getTextStyle().setFontSize(30).setBold(true).setForegroundColor(CD_VIOLET);
  title.insertTextBox((meta.mesLbl || '') + ' · ' + (meta.fyLbl || ''), 40, h / 2 + 2, w - 80, 34)
       .getText().getTextStyle().setFontSize(15).setForegroundColor('#8E5FF3');
  def.remove();
  pres.saveAndClose();
  return { id: pres.getId(), url: pres.getUrl(), w: w, h: h };
}

// Agrega UNA slide. entry.kind: 'divider' | 'resumen' | 'evo' | 'bridge'.
// entry.tableImg = {img:'data:image/png;base64,...', w, h} → la tabla, como imagen.
// (OKRs y cualquier otra slide que sea solo tabla van por cierreDeckAddImageSlide.)
function cierreDeckAddSlide(presId, entry, pageW, pageH) {
  if (typeof Slides === 'undefined') throw new Error('Servicio avanzado Slides no disponible');
  var b = _cdBuilder_(presId, pageW, pageH);
  switch (entry && entry.kind) {
    case 'divider': _cdDivider_(b, entry); break;
    case 'resumen': _cdResumen_(b, entry); break;
    case 'evo':
    case 'bridge':  _cdChartAndTable_(b, entry); break;
    default: throw new Error('Tipo de slide no soportado: ' + (entry && entry.kind));
  }
  Slides.Presentations.batchUpdate({ requests: b.reqs }, presId);
  if (b.images.length) {
    try {
      var pres = SlidesApp.openById(presId);
      b.images.forEach(function(im) {
        var slide = pres.getSlideById(im.page);
        if (slide) _cdInsertImageFit_(slide, im.img, im.x, im.y, im.w, im.h, im.align);
      });
      pres.saveAndClose();
    } catch (e) {
      // Sin la tabla la slide queda incompleta: se borra y el cliente la reenvía entera como imagen.
      try { Slides.Presentations.batchUpdate({ requests: b.pages.map(function(id) { return { deleteObject: { objectId: id } }; }) }, presId); } catch (e2) {}
      throw e;
    }
  }
  return { ok: true, slides: b.slides, requests: b.reqs.length };
}

// Inserta una imagen data:URL ajustada a la caja preservando proporción.
// align: 'top-left' (arriba a la izquierda) | 'center' (default).
function _cdInsertImageFit_(slide, img, l, t, bw, bh, align) {
  var src = typeof img === 'object' ? img : { img: img };
  var b64 = String(src.img).replace(/^data:image\/png;base64,/, '');
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', 'tabla.png');
  var ratio = src.w && src.h ? src.w / src.h : bw / bh;
  var iw = bw, ih = iw / ratio;
  if (ih > bh) { ih = bh; iw = ih * ratio; }
  var left = align === 'top-left' ? l : l + (bw - iw) / 2;
  var top  = align === 'top-left' ? t : t + (bh - ih) / 2;
  slide.insertImage(blob, left, top, iw, ih);
}

// Respaldo: la slide como imagen (misma captura html2canvas de antes) con header nativo.
function cierreDeckAddImageSlide(presId, entry) {
  var pres = SlidesApp.openById(presId);
  var w = pres.getPageWidth(), h = pres.getPageHeight(), sx = w / 720, sy = h / 405;
  var slide = pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
  if (!entry || !entry.img) {
    slide.insertTextBox('No se pudo generar esta slide (revisar consola del navegador).', 40, h / 2 - 12, w - 80, 24)
         .getText().getTextStyle().setFontSize(14).setForegroundColor('#C0392B');
    return { ok: false };
  }
  var b64 = String(entry.img).replace(/^data:image\/png;base64,/, '');
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', 'slide.png');
  function fit(l, t, bw, bh) {
    var ratio = entry.w && entry.h ? entry.w / entry.h : bw / bh;
    var iw = bw, ih = iw / ratio;
    if (ih > bh) { ih = bh; iw = ih * ratio; }
    slide.insertImage(blob, l + (bw - iw) / 2, t + (bh - ih) / 2, iw, ih);
  }
  if (entry.kind === 'divider' || !entry.title) { fit(0, 0, w, h); return { ok: true }; }
  var tb = slide.insertTextBox(entry.title, 0, 0, 660 * sx, 65 * sy);
  tb.getText().getTextStyle().setFontSize(20).setBold(true).setForegroundColor(CD_VIOLET);
  tb.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
  var bars = CD_LOGO_W.map(function(ew, i) {
    var r = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 660 * sx, (4 + i * 5.583) * sy,
                              (ew / 12700) * 0.89 * sx, 3.26 * sy);
    r.getFill().setSolidFill(CD_BAR); r.getBorder().setTransparent();
    return r;
  });
  try { slide.group(bars); } catch (e) {}
  var line = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 64 * sy, w, 1.4 * sy);
  line.getFill().setSolidFill(CD_BAR); line.getBorder().setTransparent();
  fit(24 * sx, 72 * sy, w - 48 * sx, h - 82 * sy);
  return { ok: true };
}

// ── Builder de requests (Slides API, unidades en pt) ─────────────────────

function _cdBuilder_(presId, W, H) {
  var seed = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  var b = { reqs: [], n: 0, W: W || 720, H: H || 405, slides: 0, images: [], pages: [] };
  b.sx = b.W / 720; b.sy = b.H / 405;
  b.id = function(p) { return 'cd' + seed + p + (b.n++); };
  b.top = 72 * b.sy;                 // arranque del contenido (debajo de la línea del header)
  b.bottom = b.H - 10 * b.sy;
  b.side = 24 * b.sx;
  return b;
}

function _cdRgb_(hex) {
  hex = String(hex || '#000000').replace('#', '');
  if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
  return { red: parseInt(hex.substr(0, 2), 16) / 255,
           green: parseInt(hex.substr(2, 2), 16) / 255,
           blue: parseInt(hex.substr(4, 2), 16) / 255 };
}
function _cdHex_(c) { return c && typeof c === 'object' ? c.hex : c; }
function _cdAlpha_(c) { return c && typeof c === 'object' && c.alpha != null ? c.alpha : 1; }

function _cdEP_(page, x, y, w, h) {
  return { pageObjectId: page,
           size: { width: { magnitude: Math.max(w, 1), unit: 'PT' }, height: { magnitude: Math.max(h, 1), unit: 'PT' } },
           transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: 'PT' } };
}

function _cdSlide_(b) {
  var id = b.id('p');
  b.reqs.push({ createSlide: { objectId: id, slideLayoutReference: { predefinedLayout: 'BLANK' } } });
  b.slides++;
  b.pages.push(id);
  return id;
}

function _cdFill_(b, id, fill, outline) {
  var props = {}, f = [];
  if (fill) {
    props.shapeBackgroundFill = { solidFill: { color: { rgbColor: _cdRgb_(_cdHex_(fill)) }, alpha: _cdAlpha_(fill) } };
    f.push('shapeBackgroundFill.solidFill.color', 'shapeBackgroundFill.solidFill.alpha');
  } else {
    props.shapeBackgroundFill = { propertyState: 'NOT_RENDERED' };
    f.push('shapeBackgroundFill.propertyState');
  }
  if (outline) {
    props.outline = { outlineFill: { solidFill: { color: { rgbColor: _cdRgb_(outline.color) } } },
                      weight: { magnitude: outline.weight || 1, unit: 'PT' } };
    f.push('outline.outlineFill.solidFill.color', 'outline.weight');
  } else {
    props.outline = { propertyState: 'NOT_RENDERED' };
    f.push('outline.propertyState');
  }
  b.reqs.push({ updateShapeProperties: { objectId: id, shapeProperties: props, fields: f.join(',') } });
}

function _cdShape_(b, page, type, x, y, w, h, fill, outline) {
  var id = b.id('s');
  b.reqs.push({ createShape: { objectId: id, shapeType: type, elementProperties: _cdEP_(page, x, y, w, h) } });
  _cdFill_(b, id, fill, outline);
  return id;
}

function _cdTextStyle_(b, target, st, range) {
  var style = {}, f = [];
  if (st.size) { style.fontSize = { magnitude: st.size, unit: 'PT' }; f.push('fontSize'); }
  if (st.bold != null) { style.bold = !!st.bold; f.push('bold'); }
  if (st.italic != null) { style.italic = !!st.italic; f.push('italic'); }
  if (st.color) { style.foregroundColor = { opaqueColor: { rgbColor: _cdRgb_(st.color) } }; f.push('foregroundColor'); }
  if (st.font) { style.fontFamily = st.font; f.push('fontFamily'); }
  if (!f.length) return;
  var r = { textRange: range, style: style, fields: f.join(',') };
  for (var k in target) r[k] = target[k];
  b.reqs.push({ updateTextStyle: r });
}

function _cdParaStyle_(b, target, align) {
  var r = { textRange: { type: 'ALL' },
            style: { alignment: align || 'START', lineSpacing: 100,
                     spaceAbove: { magnitude: 0, unit: 'PT' }, spaceBelow: { magnitude: 0, unit: 'PT' } },
            fields: 'alignment,lineSpacing,spaceAbove,spaceBelow' };
  for (var k in target) r[k] = target[k];
  b.reqs.push({ updateParagraphStyle: r });
}

// Cuadro de texto. st: {size,bold,italic,color,align('START'|'CENTER'|'END'),valign('TOP'|'MIDDLE'|'BOTTOM')}
//   st.exact = true → (x,y,w,h) es el área de TEXTO (se compensa el margen fijo de 7,2pt).
//   st.runs  = [{t,color,bold,italic}] → tramos con estilo propio (text se ignora).
function _cdText_(b, page, x, y, w, h, text, st) {
  st = st || {};
  if (st.exact) { x -= CD_INSET; y -= CD_INSET; w += 2 * CD_INSET; h += 2 * CD_INSET; }
  if (st.runs) text = st.runs.map(function(r) { return r.t; }).join('');
  var id = b.id('t');
  b.reqs.push({ createShape: { objectId: id, shapeType: 'TEXT_BOX', elementProperties: _cdEP_(page, x, y, w, h) } });
  if (text == null || text === '') return id;
  b.reqs.push({ insertText: { objectId: id, text: String(text), insertionIndex: 0 } });
  _cdTextStyle_(b, { objectId: id }, { size: st.size || 10, bold: !!st.bold, italic: !!st.italic,
                                       color: st.color || CD_TXT, font: st.font || 'Arial' }, { type: 'ALL' });
  if (st.runs) {
    var pos = 0;
    st.runs.forEach(function(run) {
      var L = run.t.length;
      if (L && run.t.replace(/\s/g, '') && (run.color || run.bold || run.italic)) {
        _cdTextStyle_(b, { objectId: id }, { color: run.color, bold: run.bold ? true : null, italic: run.italic ? true : null },
                      { type: 'FIXED_RANGE', startIndex: pos, endIndex: pos + L });
      }
      pos += L;
    });
  }
  _cdParaStyle_(b, { objectId: id }, st.align);
  if (st.valign) b.reqs.push({ updateShapeProperties: { objectId: id, shapeProperties: { contentAlignment: st.valign }, fields: 'contentAlignment' } });
  return id;
}

// Línea recta de (x1,y1) a (x2,y2). Slides dibuja de la esquina sup-izq a la inf-der de la
// caja; para las que "suben" o van hacia la izquierda se espeja con escala negativa.
function _cdLine_(b, page, x1, y1, x2, y2, st) {
  st = st || {};
  var id = b.id('l');
  var w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  b.reqs.push({ createLine: { objectId: id, lineCategory: 'STRAIGHT', elementProperties: {
    pageObjectId: page,
    size: { width: { magnitude: Math.max(w, 0.01), unit: 'PT' }, height: { magnitude: Math.max(h, 0.01), unit: 'PT' } },
    transform: { scaleX: x2 >= x1 ? 1 : -1, scaleY: y2 >= y1 ? 1 : -1, translateX: x1, translateY: y1, unit: 'PT' } } } });
  var props = { lineFill: { solidFill: { color: { rgbColor: _cdRgb_(st.color || '#D0D7DE') } } },
                weight: { magnitude: st.weight || 1, unit: 'PT' } };
  var f = ['lineFill.solidFill.color', 'weight'];
  if (st.dash) { props.dashStyle = st.dash; f.push('dashStyle'); }
  if (st.endArrow) { props.endArrow = st.endArrow; f.push('endArrow'); }
  b.reqs.push({ updateLineProperties: { objectId: id, lineProperties: props, fields: f.join(',') } });
  return id;
}

// ── Header (título + isotipo + línea) ────────────────────────────────────
function _cdHeader_(b, page, title) {
  var sx = b.sx, sy = b.sy;
  _cdText_(b, page, 0, 0, 660 * sx, 65 * sy, title, { size: 20, bold: true, color: CD_VIOLET, valign: 'MIDDLE' });
  var bars = CD_LOGO_W.map(function(ew, i) {
    return _cdShape_(b, page, 'RECTANGLE', 660 * sx, (4 + i * 5.583) * sy, (ew / 12700) * 0.89 * sx, 3.26 * sy, CD_BAR, null);
  });
  b.reqs.push({ groupObjects: { childrenObjectIds: bars, groupObjectId: b.id('g') } });
  _cdShape_(b, page, 'RECTANGLE', 0, 64 * sy, b.W, 1.4 * sy, CD_BAR, null);
}

// ── Cuadro resumen: tabla a la izquierda + panel "Highlights" a la derecha ─
function _cdResumen_(b, e) {
  var sx = b.sx, sy = b.sy;
  var page = _cdSlide_(b);
  _cdHeader_(b, page, e.title);
  if (e.tableImg) b.images.push({ page: page, img: e.tableImg, x: 17 * sx, y: b.top + 4 * sy,
                                  w: 368 * sx, h: b.bottom - b.top - 4 * sy, align: 'top-left' });

  var px = 402 * sx, py = b.top + 12 * sy, pw = 300 * sx, ph = b.bottom - py - 4 * sy;
  var box = _cdShape_(b, page, 'ROUND_RECTANGLE', px, py, pw, ph, '#FFFFFF', { color: CD_VIOLET, weight: 1.5 });
  _cdText_(b, page, px + 12 * sx, py + 8 * sy, pw - 24 * sx, 24 * sy, 'Highlights',
           { size: 16, bold: true, color: CD_VIOLET, align: 'CENTER' });
  var TONE = { pos: '#16A34A', neg: '#C0392B', neu: CD_MUTED };
  var hl = e.highlight ? String(e.highlight) : '';
  var ph2 = 'Comentarios de los analistas…';
  var bodyId = _cdText_(b, page, px + 14 * sx, py + 40 * sy, pw - 28 * sx, ph - 52 * sy,
                        hl ? hl + '\n' + ph2 : ph2, { size: 11, color: CD_MUTED });
  b.reqs.push({ createParagraphBullets: { objectId: bodyId, textRange: { type: 'ALL' }, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } });
  if (hl) {
    _cdTextStyle_(b, { objectId: bodyId }, { bold: true, color: TONE[e.hlTone] || TONE.neu },
                  { type: 'FIXED_RANGE', startIndex: 0, endIndex: hl.length });
  }
  var start = hl ? hl.length + 1 : 0;
  _cdTextStyle_(b, { objectId: bodyId }, { italic: true, color: '#8A8F98' },
                { type: 'FIXED_RANGE', startIndex: start, endIndex: start + ph2.length });
  return box;
}

// ── Gráfico (arriba) + tabla (abajo): Evolutivos y Bridge OC ─────────────
function _cdChartAndTable_(b, e) {
  var page = _cdSlide_(b);
  _cdHeader_(b, page, e.title);
  var x = b.side, w = b.W - b.side * 2, areaH = b.bottom - b.top, gap = 6 * b.sy;
  // Alto de la tabla-imagen: el que le toca a todo el ancho según su proporción, con tope
  // (42% del área en Evolutivos, 34% en Bridge) para que el gráfico conserve protagonismo.
  var tH = 0, t = e.tableImg;
  if (t && t.w && t.h) tH = Math.min(w * t.h / t.w, areaH * (e.kind === 'evo' ? 0.42 : 0.34));
  var chartH = areaH - tH - (tH ? gap : 0);
  if (e.chart && e.chart.type === 'waterfall') _cdWaterfall_(b, page, x, b.top, w, chartH, e.chart);
  else if (e.chart && e.chart.type === 'combo') _cdCombo_(b, page, x, b.top, w, chartH, e.chart);
  if (tH) b.images.push({ page: page, img: t, x: x, y: b.top + chartH + gap, w: w, h: tH, align: 'center' });
}

// Waterfall: barras flotantes [lo,hi] con etiqueta arriba, nombres abajo y flecha de Δ total.
function _cdWaterfall_(b, page, x, y, w, h, s) {
  var n = s.labels.length, slot = w / n, bw = slot * 0.62;
  var plotT = y + 30, plotB = y + h - 16, plotH = plotB - plotT;
  var lo0 = s.yMin, span = (s.yMax - s.yMin) || 1;
  function Y(v) { return plotB - (Math.max(v, lo0) - lo0) / span * plotH; }
  _cdLine_(b, page, x, plotB, x + w, plotB, { color: '#D0D7DE', weight: 0.75 });
  var tops = [];
  s.floats.forEach(function(f, i) {
    var yt = Y(f[1]), yb = Y(f[0]);
    var bx = x + slot * i + (slot - bw) / 2;
    _cdShape_(b, page, 'RECTANGLE', bx, yt, bw, Math.max(yb - yt, 1), s.colors[i], null);
    _cdText_(b, page, x + slot * i, yt - 12, slot, 10, s.texts[i],
             { size: 8, bold: true, color: s.textColors[i], align: 'CENTER', valign: 'BOTTOM', exact: true });
    _cdText_(b, page, x + slot * i, plotB + 3, slot, 10, s.labels[i], { size: 7, color: CD_MUTED, align: 'CENTER', exact: true });
    tops.push(yt);
  });
  if (s.totalText && n > 1) {
    var col = s.totalDelta >= 0 ? '#10B132' : '#E06666';
    var ay = y + 12, xa = x + slot * 0.5, xb = x + slot * (n - 0.5);
    _cdLine_(b, page, xa, ay, xa, tops[0] - 16, { color: col, weight: 0.75, dash: 'DOT' });
    _cdLine_(b, page, xb, ay, xb, tops[n - 1] - 16, { color: col, weight: 0.75, dash: 'DOT' });
    _cdLine_(b, page, xa, ay, xb, ay, { color: col, weight: 1, endArrow: 'FILL_ARROW' });
    _cdText_(b, page, x + w / 2 - 70, ay - 12, 140, 10, s.totalText, { size: 8, bold: true, color: col, align: 'CENTER', valign: 'BOTTOM', exact: true });
  }
}

// Combo de Evolutivos: barras (Actuals/RR + Budget) en la franja de abajo y líneas punteadas
// de %GB en la de arriba (mismo reparto que el chart del Hub, ver _evoChartCfg_ dualPctGb).
function _cdCombo_(b, page, x, y, w, h, s) {
  var legendH = 14, xLabH = 13;
  var items = (s.lines || []).map(function(l) { return { t: l.label, c: l.color, line: true, dash: l.dash }; })
    .concat((s.bars || []).map(function(bb) { return { t: bb.label, c: bb.legendColor }; }));
  var itemW = 92, lx = x + w / 2 - items.length * itemW / 2;
  items.forEach(function(it, i) {
    var ix = lx + i * itemW;
    if (it.line) _cdLine_(b, page, ix, y + 6, ix + 14, y + 6, { color: _cdHex_(it.c), weight: 1.5, dash: it.dash ? 'DASH' : null });
    else _cdShape_(b, page, 'RECTANGLE', ix + 2, y + 2, 10, 8, it.c, null);
    _cdText_(b, page, ix + 16, y + 1, itemW - 18, 10, it.t, { size: 7, color: CD_MUTED, valign: 'MIDDLE', exact: true });
  });

  var plotT = y + legendH + 2, plotB = y + h - xLabH, plotH = plotB - plotT;
  var n = s.labels.length, slot = w / n;
  var nb = (s.bars || []).length || 1, gw = slot * 0.8, bw = gw / nb;
  var bvals = [0];
  (s.bars || []).forEach(function(bb) { bb.values.forEach(function(v) { if (v != null) bvals.push(v); }); });
  var bmax = Math.max.apply(null, bvals), bmin = Math.min.apply(null, bvals);
  var bandH = plotH * 0.50, bspan = (bmax - bmin) || 1;   // barras: mitad de abajo
  function YB(v) { return plotB - (v - bmin) / bspan * bandH; }
  _cdLine_(b, page, x, plotB, x + w, plotB, { color: '#D0D7DE', weight: 0.75 });
  (s.bars || []).forEach(function(bb, j) {
    bb.values.forEach(function(v, i) {
      if (v == null) return;
      var bx = x + slot * i + (slot - gw) / 2 + bw * j;
      var yt = YB(Math.max(v, 0)), yb = YB(Math.min(v, 0));
      _cdShape_(b, page, 'RECTANGLE', bx + bw * 0.07, yt, bw * 0.86, Math.max(yb - yt, 1), bb.colors[i], null);
      _cdText_(b, page, bx - 6, yt - 9, bw + 12, 8, bb.texts[i],
               { size: 6, bold: j === 0, color: j === 0 ? CD_TXT : '#8C959F', align: 'CENTER', valign: 'BOTTOM', exact: true });
    });
  });
  s.labels.forEach(function(lb, i) {
    _cdText_(b, page, x + slot * i, plotB + 3, slot, 9, lb, { size: 6.5, color: CD_MUTED, align: 'CENTER', exact: true });
  });

  var lv = [];
  (s.lines || []).forEach(function(l) { l.values.forEach(function(v) { if (v != null) lv.push(v); }); });
  if (!lv.length) return;
  var pmax = Math.max.apply(null, lv), pmin = Math.min.apply(null, lv), pspan = Math.max(pmax - pmin, 0.5);
  var lT = plotT + plotH * 0.06, lH = plotH * 0.20;   // líneas de %GB: franja de arriba
  function YL(v) { return lT + (pmax - v) / pspan * lH; }
  s.lines.forEach(function(l) {
    var prev = null, col = _cdHex_(l.color);
    l.values.forEach(function(v, i) {
      if (v == null) return;
      var px = x + slot * (i + 0.5), py = YL(v);
      if (prev) _cdLine_(b, page, prev[0], prev[1], px, py, { color: col, weight: 1.25, dash: l.dash ? 'DASH' : null });
      prev = [px, py];
      _cdShape_(b, page, 'ELLIPSE', px - 2, py - 2, 4, 4, l.color, null);
      var ly = l.pos === 'below' ? py + 3 : py - 10;
      _cdText_(b, page, px - 20, ly, 40, 7, l.texts[i],
               { size: 6, bold: l.pos !== 'below', color: col, align: 'CENTER', valign: l.pos === 'below' ? 'TOP' : 'BOTTOM', exact: true });
    });
  });
}

// ── Divisor de sección (fondo violeta, círculo, título, logo) ────────────
function _cdDivider_(b, e) {
  var page = _cdSlide_(b), k = b.W / 1120;   // el divisor del preview mide 1120x630 px
  b.reqs.push({ updatePageProperties: { objectId: page,
    pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: _cdRgb_('#5626E9') } } } },
    fields: 'pageBackgroundFill.solidFill.color' } });
  _cdShape_(b, page, 'ELLIPSE', b.W - 290 * k, 20 * k, 370 * k, 370 * k, { hex: '#FFFFFF', alpha: 0.10 }, null);
  _cdText_(b, page, 64 * k - 7, 232 * k, 820 * k, 70 * k, e.title || '', { size: 30, bold: true, color: '#FFFFFF', valign: 'BOTTOM' });
  if (e.sub) _cdText_(b, page, 64 * k - 7, 302 * k, 600 * k, 26 * k, e.sub, { size: 11, bold: true, color: '#D9CFFC' });
  var lx = 64 * k, ly = b.H - 48 * k - 28 * k;
  var hs = [10, 16, 22, 28, 22, 16, 10], bars = hs.map(function(hh, i) {
    return _cdShape_(b, page, 'RECTANGLE', lx + i * 7 * k, ly + (28 - hh) / 2 * k, 5 * k, hh * k, i < 3 ? '#7B4DF0' : '#8E5FF3', null);
  });
  b.reqs.push({ groupObjects: { childrenObjectIds: bars, groupObjectId: b.id('g') } });
  _cdText_(b, page, lx + 60 * k, ly - 1 * k, 200 * k, 16 * k, 'DESPEGAR', { size: 12, bold: true, color: '#FFFFFF', valign: 'MIDDLE', exact: true });
  _cdText_(b, page, lx + 60 * k, ly + 18 * k, 200 * k, 9 * k, 'G R O U P', { size: 5.5, color: '#E6DEFD', valign: 'MIDDLE', exact: true });
}
