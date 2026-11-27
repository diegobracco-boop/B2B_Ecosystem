/* Hub (P&L Dashboard) en Ownia — "KRs HTML · RR" desde el OKR Status (2026-11-27; ese mismo día era una sub-vista del P&L
 * Accounting y se mudó acá). Lo inyecta server/index.js en el Hub (`layout` en server/modules.js). El HTML de Apps Script no se toca.
 *
 * Botón "Ver detalle" en la cabecera del OKR Status (#okr-col, salvo con B2B2C) → ventana con formato slide (16:9) con los KRs H2
 * del canal HTML del Daily B2B Tracker medidos con el Run Rate vigente del mes completo vs el Budget del mes: selector de mes,
 * Organic YES/NO, tabla resumen (KR | Peso | RR mes | Budget mes | Cumpl. + OVERALL) y los recuadros por país.
 * Backend: getKRsHtmlRR(ym, organic) en Dashboard_B2B_WLs/Codigo_krs_rr.js (cálculo puro computeKRsHtmlRR_, test_krsHtmlRR.js).
 * La lámina se arma a 1400 px de ancho y se escala (transform) para entrar entera en la ventana: nunca scroll lateral.
 * Cierra con ✕, Esc o clic en el fondo.
 *
 * ⚠ SYNC con Daily_Dashboard/tracker.html (renderStatusKRsH2 / renderStatusKRsH2DetailBoxes_ / recurDetailBox_): umbrales de
 * color (krBajo80_/krBajo100_), formatos y columnas.
 */
(function () {
  'use strict';
  var W = window, SLIDE_W = 1400, SLIDE_H = 788;   // 16:9

  var css = document.createElement('style');
  css.textContent = [
    '.krr-open-btn{background:#1E1B4B!important;color:#fff!important}.krr-open-btn:hover{background:#3f41b0!important}',
    '#krr-ov{position:fixed;inset:0;z-index:3000;background:rgba(15,13,40,.6);display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}',
    '#krr-ov .krr-dlg{background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.4);display:flex;flex-direction:column;overflow:hidden;',
    'width:min(calc(100vw - 48px),calc((100vh - 48px - 54px) * 16 / 9),1700px);min-width:min(560px,calc(100vw - 48px));margin:auto}',
    '.krr-top{background:#1E1B4B;color:#fff;padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;min-height:54px;box-sizing:border-box}',
    '.krr-top h3{margin:0;font-size:15px;font-weight:800;flex:1 1 auto;min-width:200px;line-height:1.25}',
    '.krr-top h3 small{display:block;font-size:11px;font-weight:500;color:rgba(255,255,255,.7);margin-top:1px}',
    '.krr-top label{font-size:10px;font-weight:700;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.06em}',
    '.krr-top select{border:1px solid rgba(196,181,253,.4);border-radius:7px;padding:4px 8px;font:600 12px inherit;font-family:inherit;color:#1E1B4B;background:#fff;cursor:pointer}',
    '.krr-sw{display:inline-flex;gap:2px;background:rgba(255,255,255,.08);border:1px solid rgba(196,181,253,.25);border-radius:7px;padding:2px}',
    '.krr-sw button{border:none;background:transparent;color:rgba(255,255,255,.7);font-size:11px;font-weight:700;padding:4px 10px;border-radius:5px;cursor:pointer;font-family:inherit}',
    '.krr-sw button.active{background:#7C3AED;color:#fff}.krr-sw button:hover:not(.active){background:rgba(255,255,255,.12);color:#fff}',
    '.krr-close{border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;font-size:16px;line-height:1;width:30px;height:30px;border-radius:7px;cursor:pointer}',
    '.krr-close:hover{background:rgba(255,255,255,.15)}',
    '.krr-stage{aspect-ratio:16/9;width:100%;overflow:hidden;display:flex;align-items:flex-start;justify-content:center;background:#f4f4fa}',
    '.krr-stage.krr-msg{align-items:center;color:#6b6890;font-size:13px}',
    '.krr-stage.krr-msg.err{color:#CF222E}',
    '.krr-wrap{overflow:hidden;flex:0 0 auto}',
    // La lámina (1400 de ancho; alto natural, mínimo 788 = 16:9): mismo look que el Status KRs H2 del Tracker
    '.krr-slide{width:' + SLIDE_W + 'px;min-height:' + SLIDE_H + 'px;box-sizing:border-box;background:#fff;color:#1f1d3a;padding:28px 36px 22px;display:flex;flex-direction:column;transform-origin:top left}',
    '.krr-slide .s-kicker{font-size:12px;font-weight:700;color:#5457D9;letter-spacing:.08em;text-transform:uppercase}',
    '.krr-slide .s-title{font-size:27px;font-weight:800;margin:3px 0 4px;color:#1E1B4B}',
    '.krr-meta{font-size:11.5px;color:#6b7280;margin-bottom:16px;display:flex;flex-wrap:wrap;gap:3px 16px}',
    '.krr-meta .warn{color:#b45309}',
    '.krr-row1{display:flex;gap:18px;align-items:stretch}',
    '.krr-card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;box-shadow:0 2px 6px rgba(99,102,241,.07)}',
    '.krr-sum{flex:0 0 720px;box-sizing:border-box}',
    '.krr-read{flex:1 1 auto;font-size:11.5px;color:#4b4870;line-height:1.5;background:#f8f7fd;border:1px solid #e6e5f0;border-radius:10px;padding:12px 16px}',
    '.krr-read b{color:#1E1B4B}.krr-read p{margin:0 0 6px}',
    '.krr-ov-big{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}',
    '.krr-ov-big .lbl{font-size:11px;font-weight:700;color:#6b6890;text-transform:uppercase;letter-spacing:.06em}',
    '.krr-ov-big .krr-chip{font-size:22px;padding:2px 12px}',
    '.krr-table{width:100%;border-collapse:collapse;font-size:12px}',
    '.krr-table thead th{background:linear-gradient(to bottom,#ede9fe,#f3f0fe);color:#550FED;font-weight:700;padding:5px 6px;text-align:right;border-bottom:2px solid #7c3aed;white-space:nowrap;font-size:11px;text-transform:uppercase;letter-spacing:.3px}',
    '.krr-table thead th:first-child{text-align:left}',
    '.krr-table td{padding:4px 6px;border-bottom:1px solid #f3f4f6;text-align:right;white-space:nowrap;color:#374151;font-variant-numeric:tabular-nums}',
    '.krr-table td:first-child{text-align:left}',
    '.krr-sum td{font-size:13px;padding:6px 8px}',
    '.krr-sum tr.krr-overall td{font-weight:700;color:#1f2937;border-top:2px solid #550FED;background:#F9FAFB}',
    '.krr-peso{color:#6b7280;font-size:.78rem}',
    '.krr-note{color:#6b7280;font-size:.72rem}',
    '.krr-chip{display:inline-block;padding:1px 8px;border-radius:5px;border:1.5px dashed;font-weight:600;line-height:1.4}',
    '.krr-red{background:#fbe0e0;color:#a01a1a;border-color:#d34a4a}',
    '.krr-yellow{background:#fdf1cf;color:#8a5a00;border-color:#c99a2e}',
    '.krr-green{background:#d9f2e1;color:#2f7d4f;border-color:#4fae74}',
    '.krr-neg{color:#E82525!important}.krr-pos{color:#599E6B!important}',
    '.krr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(0,.85fr);gap:12px;margin-top:16px;align-items:start}',
    '.krr-box{min-width:0;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 10px;box-shadow:0 2px 6px rgba(99,102,241,.07)}',
    '.krr-box-hd{font-size:.75rem;font-weight:800;color:#1e1b4b;margin-bottom:8px;padding-bottom:7px;border-bottom:3px solid #6366f1;display:flex;align-items:center;gap:8px}',
    '.krr-badge{background:linear-gradient(135deg,#6366f1 0%,#4f46e5 100%);color:#fff;border-radius:6px;padding:3px 10px;font-size:.85rem;font-weight:800;letter-spacing:.03em;box-shadow:0 2px 4px rgba(99,102,241,.35);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.krr-box .krr-table th{font-weight:600;color:#6b7280;background:#f9fafb;font-size:.7rem;border-bottom:1px solid #e5e7eb;text-transform:none;letter-spacing:0;padding:4px 5px;line-height:1.2}',
    '.krr-box .krr-table td{font-size:.8rem;padding:3px 5px}',
    '.krr-box .krr-table td:first-child,.krr-box .krr-table th:first-child{max-width:84px;width:84px;overflow:hidden;text-overflow:ellipsis}',
    '.krr-box .krr-table td.krr-yb{font-style:italic}',
    '.krr-box .krr-table tr.krr-tot td{font-weight:700;background:#F9FAFB;border-bottom:1px solid #e5e7eb}',
    '.krr-box .krr-table td.krr-pesocell{color:#6b7280}',
    '.krr-slide .s-foot{margin-top:auto;padding-top:10px;font-size:10px;color:#8a88a0;line-height:1.45;border-top:1px solid #e6e5f0}',
    '@media (max-width:700px){#krr-ov{padding:0}#krr-ov .krr-dlg{border-radius:0;width:100vw;min-width:0}}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  // ── Estado de la ventana ──
  var st = { ym: '', organic: true, seq: 0, last: null, loading: false, err: '' };

  // ── Formatos (movidos tal cual del P&L Accounting; fmtKRVal / cumplBg / cumplCellHtml / yoyIcon / yoyColor del Tracker) ──
  var _KRR_MESES_ = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  function _krrYmLbl_(ym){ return ym ? _KRR_MESES_[+ym.substring(5,7)-1] + ' ' + ym.substring(0,4) : '—'; }
  function _krrEsc_(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  // montos en USD: '$M' en millones, '$Kint' en miles enteros, 'int' enteros
  function _krrFmt_(v, unit){
    if(v === null || v === undefined || isNaN(v)) return '—';
    if(unit === 'int')   return Math.round(v).toLocaleString('es-AR');
    if(unit === '$M')    return '$ ' + (v / 1e6).toFixed(2) + ' M';
    if(unit === '$Kint') return '$ ' + (Math.round(v / 1e3) || 0).toLocaleString('es-AR') + ' K';
    return String(v);
  }
  function _krrPct_(c){ return (c === null || c === undefined || !isFinite(c)) ? '—' : (c * 100).toFixed(0) + '%'; }
  function _krrChipCls_(p){
    if(p === null || p === undefined || !isFinite(p) || isNaN(p)) return '';
    var r = Math.round(p * 100);
    return r < 80 ? 'krr-red' : r < 100 ? 'krr-yellow' : 'krr-green';
  }
  function _krrChip_(p, inner){ var cls = _krrChipCls_(p); return cls ? '<span class="krr-chip ' + cls + '">' + inner + '</span>' : inner; }
  function _krrCumplTd_(p, text, bold, title){
    var inner = bold ? '<strong>' + text + '</strong>' : text;
    var t = title ? ' title="' + _krrEsc_(title) + '"' : '';
    return '<td' + t + '>' + _krrChip_(p, inner) + '</td>';
  }
  function _krrYoy_(v){
    if(v === null || v === undefined || isNaN(v) || !isFinite(v)) return '—';
    var p = v * 100;
    return (p < 0 ? '▼' : p < 10 ? '▶' : '▲') + ' ' + Math.abs(p).toFixed(0) + '%';
  }
  function _krrYoyCls_(v){ return (v === null || v === undefined || isNaN(v) || !isFinite(v)) ? '' : (v < 0 ? 'krr-neg' : 'krr-pos'); }

  // ── La lámina (lo que antes dibujaba _renderKrsRR_ en el P&L Accounting) ──
  function slideHtml(r){
    var org = r.organic || {}, meta = r.meta || {};
    var m = [];
    m.push('RR del mes completo (b2b_runrate_ri) vs Budget del mes (' + _krrEsc_(meta.budgetSource) + ')');
    if(meta.generated_at) m.push('Datos del Daily: ' + _krrEsc_(String(meta.generated_at).replace('T', ' ').substring(0, 16)));
    if(org.error) m.push('<span class="warn">' + _krrEsc_(org.error) + ' · RR nominal</span>');
    else if(org.on) m.push('Organic: RR × TC Actuals / TC Budget · YoY a TC Actuals LY' + (org.missing && org.missing.length ? ' · sin TC: ' + _krrEsc_(org.missing.slice(0, 4).join(', ')) + (org.missing.length > 4 ? ' …' : '') : ''));
    else m.push('Organic: NO (RR en USD tal cual)');
    if(!r.lyAvailable) m.push('<span class="warn">YoY en —: el JSON del Daily no trae los reales de ' + _krrYmLbl_(r.lyYm) + ' completos (LY hasta ' + _krrEsc_(meta.ly_to || 's/d') + ')</span>');
    (r.warnings || []).forEach(function(w){ m.push('<span class="warn">&#9888; ' + _krrEsc_(w) + '</span>'); });

    // Tabla principal: KR | Peso | RR mes | Budget mes | Cumpl. (realScore_) + OVERALL (okrScore_)
    var rows = (r.krs || []).map(function(k){
      var has = k.rr !== 0 || k.bud !== 0;
      return '<tr><td>' + _krrEsc_(k.name) + '</td><td class="krr-peso">' + Math.round(k.peso * 100) + '%</td>' +
        '<td>' + (has ? _krrFmt_(k.rr, k.unit) : '—') + '</td><td>' + (has ? _krrFmt_(k.bud, k.unit) : '—') + '</td>' +
        _krrCumplTd_(k.cumpl, _krrPct_(k.cumpl), false) + '</tr>';
    });
    var rc = r.recur || {};
    var recName = '<td>Accelerate Recurrence <span class="krr-note">(HTML)</span></td><td class="krr-peso">15%</td>';
    var noTgt = rc.targetsState === 'error' ? 'Sin target: no se pudo leer Input_OKR' + (rc.targetsErr ? ' (' + _krrEsc_(rc.targetsErr) + ')' : '') : 'Sin target en Input_OKR para ' + _krrYmLbl_(r.ym);
    if(!rc.cumpl){
      rows.push('<tr>' + recName + '<td colspan="3" style="text-align:center;color:#9ca3af;font-style:italic">' +
        (rc.state === 'error' ? 'Sin datos todavía (falta recurrencia_b2b.json en Drive)' : 'Sin datos de alta frecuencia para el mes') + '</td></tr>');
    } else {
      var c = rc.cumpl, tot = rc.total || {};
      var parcLbl = rc.parcial ? 'parcial al ' + String(rc.parcial.foto || '').substring(8, 10) + '/' + String(rc.parcial.foto || '').substring(5, 7) : '';
      var mtdTxt = rc.parcial ? _krrFmt_(rc.parcial.total, 'int') + ' ' + parcLbl : _krrFmt_(tot.mtd, 'int');
      var act = c.useRoll
        ? _krrFmt_(tot.roll, 'int') + ' <span class="krr-note">L4W</span> <span class="krr-note" title="Mes sin cerrar: cumplimiento = Rolling L4W vs Target">· MTD ' + mtdTxt + '</span>'
        : rc.parcial ? _krrFmt_(rc.parcial.total, 'int') + ' <span class="krr-note">' + parcLbl + '</span>' : _krrFmt_(tot.mtd, 'int');
      var cTxt = c.shown !== null ? _krrPct_(c.shown) + (c.useRoll ? ' <span style="font-size:.68rem">L4W</span>' : '') : '—';
      rows.push('<tr>' + recName + '<td>' + act + '</td><td>' + (rc.target !== null ? _krrFmt_(rc.target, 'int') :
        '<span style="color:#9ca3af;font-size:.72rem;font-style:italic">' + noTgt + '</span>') + '</td>' + _krrCumplTd_(c.shown, cTxt, false) + '</tr>');
    }
    var ov = r.overall || {};
    rows.push('<tr class="krr-overall"><td>OVERALL' + (ov.exclRecur ? ' <span class="krr-note" style="font-weight:400">(excl. Recurrence)</span>' : '') + '</td>' +
      '<td class="krr-peso" title="Ponderado sobre los KRs del canal HTML (el Tracker pondera también API FVM 20%): se normaliza sobre lo que suman sus pesos">' + Math.round((ov.pesoSum || 0) * 100) + '%</td>' +
      '<td>—</td><td>—</td>' + _krrCumplTd_(ov.value, _krrPct_(ov.value), false) + '</tr>');
    var sum = '<div class="krr-card krr-sum"><table class="krr-table"><thead><tr><th>KR</th><th>Peso</th><th>RR mes</th><th>Budget mes</th><th>Cumpl.</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
    var read = '<div class="krr-read"><div class="krr-ov-big"><span class="lbl">Overall HTML</span>' + _krrChip_(ov.value, '<strong>' + _krrPct_(ov.value) + '</strong>') + '</div>' +
      '<p>' + m.map(function(x){ return x; }).join('<br>') + '</p></div>';

    // Recuadros por KR: País | Peso | Cumpl. | YoY | YoY Bud. (como el recuadro HTML del Tracker, solo Recognition)
    var YB = 'YoY Budget: crecimiento que pedía el budget vs los reales del año anterior (mismo mes)';
    var boxes = (r.boxes || []).map(function(b){
      var pesoNa = 'Sin peso: hay países con monto negativo y el total queda en cero o cerca, así que el % no se puede leer';
      function pesoTd(p, bold){
        if(!b.pesoOk) return '<td class="krr-pesocell" title="' + pesoNa + '">—</td>';
        var t = (p === null || p === undefined) ? '—' : (p * 100).toFixed(Math.abs(p) < 0.1 ? 1 : 0) + '%';
        return '<td class="krr-pesocell">' + (bold ? '<strong>' + t + '</strong>' : t) + '</td>';
      }
      function cells(x, bold){
        var w = function(t){ return bold ? '<strong>' + t + '</strong>' : t; };
        return _krrCumplTd_(x.c, _krrPct_(x.c), bold, 'RR ' + _krrFmt_(x.rr, b.unit) + ' · Budget ' + _krrFmt_(x.bud, b.unit)) +
          '<td class="' + _krrYoyCls_(x.yoy) + '">' + w(_krrYoy_(x.yoy)) + '</td>' +
          '<td class="krr-yb ' + _krrYoyCls_(x.yb) + '">' + w(_krrYoy_(x.yb)) + '</td>';
      }
      var tr = '<tr class="krr-tot"><td>TOTAL</td>' + pesoTd(b.total.peso, true) + cells(b.total, true) + '</tr>' +
        b.rows.map(function(x){ return '<tr><td title="' + _krrEsc_(x.name) + '">' + _krrEsc_(x.name) + '</td>' + pesoTd(x.peso) + cells(x) + '</tr>'; }).join('');
      return '<div class="krr-box"><div class="krr-box-hd"><span class="krr-badge" title="' + _krrEsc_(b.title) + '">' + _krrEsc_(b.title) + '</span></div>' +
        '<table class="krr-table"><thead><tr><th>País</th><th title="Participación del país en el RR del canal">Peso</th><th>Cumpl.</th><th>YoY</th><th title="' + YB + '">YoY<br>Bud.</th></tr></thead>' +
        '<tbody>' + tr + '</tbody></table></div>';
    });
    // Accelerate Recurrence: País | Rolling L4W | % Cumpl. | Target (recurDetailBox_)
    var rb = '<div class="krr-box krr-box--rec"><div class="krr-box-hd"><span class="krr-badge">Accelerate Recurrence (HTML)</span></div>';
    if(!rc.cumpl){
      rb += '<div style="padding:8px 2px;color:#9ca3af;font-size:.78rem;font-style:italic">' + (rc.state === 'error' ? 'Sin datos todavía (falta recurrencia_b2b.json en Drive)' : 'Sin datos de alta frecuencia para el mes') + '</div></div>';
    } else {
      var rtr = function(x, bold){
        var b2 = function(s){ return bold ? '<strong>' + s + '</strong>' : s; };
        return '<tr' + (bold ? ' class="krr-tot"' : '') + '><td title="' + _krrEsc_(x.name) + '">' + _krrEsc_(x.name) + '</td><td>' + b2(_krrFmt_(x.roll, 'int')) + '</td>' +
          _krrCumplTd_(x.c, _krrPct_(x.c), bold) + '<td>' + b2(x.target !== null && x.target !== undefined ? _krrFmt_(x.target, 'int') : '—') + '</td></tr>';
      };
      rb += '<div style="padding:0 2px 6px;color:#6b7280;font-size:.7rem">Agencias de alta frecuencia · ' + _krrEsc_(rc.week) +
        (rc.target === null ? '<br><span style="color:#9ca3af;font-style:italic">' + noTgt + '</span>' : '') + '</div>' +
        '<table class="krr-table"><thead><tr><th>País</th><th>Rolling<br>L4W</th><th>% Cumpl.</th><th>Target</th></tr></thead><tbody>' +
        rtr({ name: 'TOTAL', roll: rc.totalRow.roll, c: rc.totalRow.c, target: rc.totalRow.target }, true) +
        (rc.rows || []).map(function(x){ return rtr(x, false); }).join('') + '</tbody></table></div>';
    }
    boxes.push(rb);
    var fy = W.FY_TAG ? ' ' + W.FY_TAG : '';
    return '<div class="krr-slide" id="krr-slide">' +
      '<div class="s-kicker">OKR H2' + fy + ' · B2B · Canal HTML (MIN) · Run Rate vs Budget</div>' +
      '<div class="s-title">KRs HTML · ' + _krrYmLbl_(r.ym) + '</div>' +
      '<div class="krr-row1">' + sum + read + '</div>' +
      '<div class="krr-grid">' + boxes.join('') + '</div>' +
      '<div class="s-foot">Los KRs H2 del canal HTML (Agencias afiliadas · B2B-MIN) del Daily B2B Tracker, medidos con el Run Rate vigente del mes completo (Recognition Date) en vez de los reales. ' +
      'Mismas definiciones y países que la vista HTML de "Status KRs H2"; Accelerate Recurrence es el mismo número que muestra el Tracker. Cumpl.: rojo &lt; 80%, amarillo &lt; 100%, verde ≥ 100%.</div>' +
      '</div>';
  }

  // ── Ventana ──
  function ovEl() { return document.getElementById('krr-ov'); }
  function topHtml() {
    var r = st.last, ym = (r && r.ym) || st.ym;
    var opts = (r && r.months || []).map(function(m){
      return '<option value="' + m + '"' + (m === ym ? ' selected' : '') + '>' + _krrYmLbl_(m) + (r && m === r.currentYm ? ' (en curso)' : '') + '</option>';
    }).join('');
    var on = st.organic;
    return '<div class="krr-top"><h3>KRs HTML · Run Rate vs Budget<small>' + (ym ? _krrYmLbl_(ym) + (r && ym === r.currentYm ? ' · mes en curso' : '') : 'Cargando…') + ' · Status KRs H2 del Daily B2B Tracker</small></h3>' +
      (opts ? '<label for="krr-month">Mes</label><select id="krr-month">' + opts + '</select>' : '') +
      '<label>Organic</label><div class="krr-sw"><button type="button" data-org="1" class="' + (on ? 'active' : '') + '" title="RR × TC Actuals / TC Budget del mes (como los reales en el Tracker); YoY a TC Actuals LY">YES</button>' +
      '<button type="button" data-org="0" class="' + (on ? '' : 'active') + '" title="RR en USD tal cual">NO</button></div>' +
      '<button type="button" class="krr-close" title="Cerrar (Esc)" aria-label="Cerrar">✕</button></div>';
  }
  function render() {
    var ov = ovEl();
    if (!ov) return;
    var body;
    if (st.err) body = '<div class="krr-stage krr-msg err">Error KRs HTML · RR: ' + _krrEsc_(st.err) + '</div>';
    else if (!st.last) body = '<div class="krr-stage krr-msg">Calculando…</div>';
    else {
      try { body = '<div class="krr-stage"><div class="krr-wrap">' + slideHtml(st.last) + '</div></div>'; }
      catch (e) { body = '<div class="krr-stage krr-msg err">Error KRs HTML · RR: ' + _krrEsc_(e && e.message || e) + '</div>'; }
    }
    ov.innerHTML = '<div class="krr-dlg" role="document">' + topHtml() + body + '</div>';
    if (st.loading && st.last) ov.querySelector('.krr-stage').style.opacity = '.45';
    var sel = ov.querySelector('#krr-month');
    if (sel) sel.onchange = function () { st.ym = sel.value; load(); };
    Array.prototype.forEach.call(ov.querySelectorAll('.krr-sw button'), function (b) {
      b.onclick = function () { var v = b.getAttribute('data-org') === '1'; if (v !== st.organic) { st.organic = v; load(); } };
    });
    ov.querySelector('.krr-close').onclick = close;
    fit();
  }
  // Escala la lámina para que entre entera en el escenario 16:9 (ancho y alto); la lámina mide SLIDE_W de ancho siempre.
  function fit() {
    var ov = ovEl(), stage = ov && ov.querySelector('.krr-stage'), wrap = stage && stage.querySelector('.krr-wrap'), slide = wrap && wrap.firstElementChild;
    if (!slide) return;
    slide.style.transform = '';
    var h = Math.max(SLIDE_H, slide.offsetHeight);
    var s = Math.min(stage.clientWidth / SLIDE_W, stage.clientHeight / h, 1.6);
    if (!(s > 0)) s = 1;
    slide.style.transform = 'scale(' + s + ')';
    wrap.style.width = Math.floor(SLIDE_W * s) + 'px';
    wrap.style.height = Math.floor(h * s) + 'px';
  }
  function load() {
    var seq = ++st.seq;
    st.loading = true; st.err = '';
    render();
    if (W.IS_DEMO) { st.loading = false; st.err = 'Sin datos en modo demo.'; render(); return; }
    W.google.script.run
      .withSuccessHandler(function (r) {
        if (seq !== st.seq) return;
        st.loading = false;
        if (!r) { st.err = 'Sin respuesta'; render(); return; }
        st.last = r; st.ym = r.ym;   // st.organic queda como lo pidió el usuario (si falla el TC, la lámina avisa que salió nominal)
        render();
      })
      .withFailureHandler(function (e) { if (seq !== st.seq) return; st.loading = false; st.err = (e && e.message) || String(e); render(); })
      .getKRsHtmlRR(st.ym, st.organic);
  }
  function open() {
    var ov = ovEl();
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'krr-ov';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-label', 'KRs HTML · Run Rate vs Budget');
      ov.onclick = function (e) { if (e.target === ov) close(); };
      document.body.appendChild(ov);
    }
    document.body.style.overflow = 'hidden';
    load();
  }
  function close() {
    var ov = ovEl();
    if (ov) ov.parentNode.removeChild(ov);
    document.body.style.overflow = '';
    st.seq++;   // una respuesta que llegue después no reabre nada
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ovEl()) close(); });
  W.addEventListener('resize', function () { if (ovEl()) fit(); });
  W.openKrsRR = open;

  // ── Botón "Ver detalle" en la cabecera del OKR Status (renderOKR del Hub reescribe #okr-col: se vuelve a poner) ──
  function addBtn() {
    var col = document.getElementById('okr-col'), hdr = col && col.firstElementChild;
    if (!hdr || col.querySelector('.okr-placeholder')) return;
    var bar = hdr.lastElementChild;
    if (!bar || !/OKR Status/.test(hdr.textContent || '')) return;
    var cur = col.querySelector('.krr-open-btn');
    var show = !(W._state && W._state.lob === 'b2b2c');   // son KRs de B2B (canal HTML)
    if (!show) { if (cur) cur.parentNode.removeChild(cur); return; }
    if (cur) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'gran-btn krr-open-btn';
    b.style.fontSize = '11px';
    b.textContent = '📈 Ver detalle';
    b.title = 'KRs HTML · Run Rate vs Budget: los KRs H2 del canal HTML del Daily B2B Tracker con el Run Rate del mes completo, en formato slide';
    b.onclick = open;
    bar.insertBefore(b, bar.firstChild);
  }
  function watch() {
    var col = document.getElementById('okr-col');
    if (!col) return false;
    new MutationObserver(addBtn).observe(col, { childList: true });
    addBtn();
    return true;
  }
  // Además de mirar #okr-col, envuelve renderOKR (función global del Hub): cubre un #okr-col que se vuelva a crear.
  document.addEventListener('DOMContentLoaded', function () {
    var orig = W.renderOKR;
    if (typeof orig !== 'function' || orig._krr) return;
    W.renderOKR = function () { var r = orig.apply(this, arguments); try { addBtn(); } catch (e) { /* nada */ } return r; };
    W.renderOKR._krr = true;
  });
  if (!watch()) {
    var mo = new MutationObserver(function () { if (watch()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
