// Corre los tests de Python de mirror/pnl_conso.py (el cliente de /ingest/canon) dentro de `npm test`. Sin Python en la máquina, se saltea.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const hay = !spawnSync(python, ['--version']).error;

test('pnl_conso.py: tests de Python (unittest)', { skip: hay ? false : 'no hay Python en esta máquina' }, () => {
  const r = spawnSync(python, ['-B', '-m', 'unittest', 'test_pnl_conso', '-v'], { cwd: path.join(__dirname, '..', 'mirror'), encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});
