'use strict';
// Lectura del consolidador del P&L (compartido.app_b2b_ecosystem), a demanda. Node no habla con la base:
// lanza consolidador_leer.py (Python, con el cliente consolidador_compartido.py) y devuelve su JSON.
// Un proceso por pedido, sin tareas de fondo ni copias en la base de la app.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const COMANDOS = new Set(['versiones', 'resumen', 'dimensiones']);
const TIMEOUT_MS = 130 * 1000;           // un poco más que el statement_timeout de 2 minutos del cliente
const MAX_STDOUT = 32 * 1024 * 1024;

/**
 * @param {object} cfg  config de la app (secrets, APP_ROOT)
 * @param {object} opts { log, execFile, python, script } — execFile/python/script se pisan en los tests
 */
function createConsolidador(cfg, opts = {}) {
  const log = opts.log || (() => {});
  const run = opts.execFile || execFile;
  const python = opts.python || process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const script = opts.script || path.join(cfg.APP_ROOT, 'consolidador_leer.py');
  const secrets = cfg.secrets || {};

  /** Qué falta para poder leer (vacío = listo). */
  function missing() {
    const out = [];
    if (!secrets.CONSOLIDADOR_DB_NAME) out.push('CONSOLIDADOR_DB_NAME');
    if (!secrets.DB_HOST || !secrets.DB_USER) out.push('DB_HOST/DB_USER');
    if (!fs.existsSync(script)) out.push('consolidador_leer.py');
    return out;
  }

  /** @returns {Promise<{ok:true,data:any}|{ok:false,code:number,error:string}>} */
  function leer(comando) {
    if (!COMANDOS.has(comando)) return Promise.resolve({ ok: false, code: 404, error: 'Consulta desconocida' });
    const falta = missing();
    if (falta.length) return Promise.resolve({ ok: false, code: 503, error: `Falta configurar: ${falta.join(', ')}` });
    return new Promise((resolve) => {
      run(python, [script, comando], { cwd: path.dirname(script), timeout: TIMEOUT_MS, maxBuffer: MAX_STDOUT, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || err.message || '').trim().split('\n').pop().slice(0, 300);
          log({ level: 'error', msg: 'consolidador: la lectura falló', comando, detail });
          return resolve({ ok: false, code: 502, error: `No se pudo leer el consolidador${detail ? `: ${detail}` : ''}` });
        }
        try { resolve({ ok: true, data: JSON.parse(stdout) }); } catch (e) {
          log({ level: 'error', msg: 'consolidador: respuesta que no es JSON', comando });
          resolve({ ok: false, code: 502, error: 'El consolidador devolvió una respuesta inválida' });
        }
      });
    });
  }

  return { leer, missing };
}

module.exports = { createConsolidador, COMANDOS };
