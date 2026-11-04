// "Pipeline Hunting" (2026-11-04): todos los deals del pipeline B2B2C H2'26 en una tabla, con un "+ Otros" que suma lo que falta para llegar
// a los totales de NR y FVM H2'27 (4,1 M y 1,5 M). Los montos los arma server/pipeline-slide.js (el mismo modelo de la slide del Flow).
const { shell, escapeHtml, CHEVRON_L } = require('./index-page');

const CSS = `<style>
  .ph-hero { text-align: left; margin-bottom: 24px; }
  .ph-hero h1 { font-size: clamp(30px, 4.6vw, 44px); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
  .ph-hero p { margin-top: 8px; color: var(--text-2); font-size: 15px; }
  .ph-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
  .ph-kpi { background: var(--tile); border-radius: 18px; padding: 16px 18px; box-shadow: inset 0 0 0 1px var(--line); }
  .ph-kpi .v { font-size: clamp(20px, 5.4vw, 28px); white-space: nowrap; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .ph-kpi .l { font-size: 13px; color: var(--text-2); margin-top: 2px; }
  .ph-card { background: var(--tile); border-radius: 20px; padding: 8px 8px 12px; box-shadow: inset 0 0 0 1px var(--line); overflow-x: auto; }
  .ph-table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
  .ph-table th { text-align: left; padding: 12px 14px; font-size: 12px; font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: .06em; }
  .ph-table td { padding: 11px 14px; border-top: 1px solid var(--line); white-space: nowrap; }
  .ph-table .n { text-align: right; }
  .ph-table td.f { color: var(--link); font-weight: 500; }
  .ph-table td.p { font-weight: 500; }
  .ph-lg { display: inline-block; width: 22px; height: 22px; margin-right: 10px; vertical-align: middle; }
  .ph-lg img { width: 22px; height: 22px; object-fit: contain; border-radius: 4px; display: block; }
  .ph-table tr.otros td { color: var(--text-2); font-style: italic; }
  .ph-table tr.total td { font-weight: 600; border-top: 2px solid var(--line); }
  @media (max-width: 720px) { .ph-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>`;

function pipelineHuntingPage({ basePath, model }) {
  const back = `<a class="back" href="${escapeHtml(basePath)}/">${CHEVRON_L} B2B Ecosystem</a>`;
  const logo = (r) => `<span class="ph-lg">${r.logo ? `<img src="${escapeHtml(`${basePath}/_gas/weekly/${r.logo}`)}" alt="">` : ''}</span>`;
  const row = (r) => `<tr><td class="f">${escapeHtml(r.fecha)}</td><td class="p">${logo(r)}${escapeHtml(r.partner)}</td><td>${escapeHtml(r.pais)}</td>
        <td class="n">${r.nr}</td><td class="n">${r.fvm}</td><td class="n">${r.y3}</td></tr>`;
  const m = model;
  return shell(`${CSS}<div class="ph-hero">
      <h1>Pipeline Hunting</h1>
      <p>Todos los deals del pipeline B2B2C ${escapeHtml(m.periodo)}, ordenados por NR H2'27. Info actualizada al ${escapeHtml(m.updated)}.</p>
    </div>
    <div class="ph-kpis">${m.kpis.map((x) => `<div class="ph-kpi"><div class="v">${escapeHtml(x.v)}</div><div class="l">${escapeHtml(x.l)}</div></div>`).join('')}</div>
    <div class="ph-card"><table class="ph-table">
      <thead><tr><th>Fecha</th><th>Partner</th><th>País</th><th class="n">NR H2'27</th><th class="n">FVM H2'27</th><th class="n">NR Y3</th></tr></thead>
      <tbody>
        ${m.all.map(row).join('\n')}
        <tr class="otros"><td></td><td>${escapeHtml(m.otrosAll.label)}</td><td></td><td class="n">${m.otrosAll.nr}</td><td class="n">${m.otrosAll.fvm}</td><td class="n"></td></tr>
        <tr class="total"><td></td><td>${escapeHtml(m.total.label)}</td><td></td><td class="n">${m.total.nr}</td><td class="n">${m.total.fvm}</td><td class="n">${m.total.y3}</td></tr>
      </tbody>
    </table></div>`, { title: 'Pipeline Hunting · B2B Ecosystem', left: back });
}

module.exports = { pipelineHuntingPage };
