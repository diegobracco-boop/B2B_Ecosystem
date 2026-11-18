// "Más tableros" en grupos (2026-11-17): orden de grupos y Monthly Industry. Los respaldos con Drive no tienen botón (2026-11-18).
const test = require('node:test');
const assert = require('node:assert');
const { indexPage } = require('../server/index-page');
const { MODULES } = require('../server/modules');

const canOpenFor = (user) => (m) => !m.allowedUsers || m.allowedUsers.includes(user);
const groups = (html) => [...html.matchAll(/class="grp-t">([^<]+)</g)].map((x) => x[1]);

test('menú: grupos de "Más tableros" en orden; los respaldos con Drive no aparecen ni para el equipo B2B', () => {
  const team = indexPage({ modules: MODULES, basePath: '/b', canOpen: canOpenFor('diego.bracco@despegar.com') });
  assert.deepEqual(groups(team), ['P&amp;L Detail', 'Industry', 'Coming soon', 'Tribus Producto', 'Manual', 'Otros tableros']);
  assert.doesNotMatch(team, /card-hub-drive|card-pnl-accounting-drive|card-pnl-managerial-drive/);
  assert.doesNotMatch(team, /respaldo con Drive/i, 'ni en "Otros tableros" ni en el buscador');

  const other = indexPage({ modules: MODULES, basePath: '/b', canOpen: canOpenFor('otra.persona@despegar.com') });
  assert.deepEqual(groups(other), ['P&amp;L Detail', 'Industry', 'Coming soon', 'Tribus Producto', 'Manual', 'Otros tableros']);
  assert.doesNotMatch(other, /card-hub-drive|card-pnl-accounting-drive|card-pnl-managerial-drive/);
  assert.match(other, /card-cosechas-b2b/);
  assert.match(other, /id="card-monthly-industry"[\s\S]*?href="https:\/\/script\.google\.com\/a\/macros\/despegar\.com\/s\/AKfycbwCgEarHTa2dSdSwTuf1Gp3OJ0rYQGjZo5jstNa8hLlDmCgXOGYDdDcV3efhl_dpij7KA\/exec" target="_blank"/);
});
