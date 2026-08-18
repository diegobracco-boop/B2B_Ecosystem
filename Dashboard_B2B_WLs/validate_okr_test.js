// TEMP: validation function — delete after use
function validateOKRNumbers() {
  var result = readOKRFromDrive_();
  var byKey = {};
  result.forEach(function(r) {
    if (r.escenario !== 'budget') return;
    var k = r.lob + '|' + r.kr + '|' + r.ym;
    byKey[k] = Math.round(r.valor);
  });

  var SHEET = {
    'b2b2c|new account net revenues|2026-04': 553866,
    'b2b2c|new account net revenues|2026-05': 911663,
    'b2b2c|new account net revenues|2026-06': 1055358,
    'b2b2c|new account net revenues|2026-07': 1086922,
    'b2b2c|new account net revenues|2026-08': 1409457,
    'b2b2c|new account net revenues|2026-09': 1416842,
    'b2b2c|existing account net revenues|2026-04': 6206704,
    'b2b2c|existing account net revenues|2026-05': 7268275,
    'b2b2c|existing account net revenues|2026-06': 7374529,
    'b2b2c|existing account net revenues|2026-07': 7575872,
    'b2b2c|existing account net revenues|2026-08': 7856764,
    'b2b2c|existing account net revenues|2026-09': 7570587,
    'b2b2c|operating contribution|2026-04': 973995,
    'b2b2c|operating contribution|2026-05': 1421107,
    'b2b2c|operating contribution|2026-06': 1495383,
    'b2b2c|operating contribution|2026-07': 1617769,
    'b2b2c|operating contribution|2026-08': 1848387,
    'b2b2c|operating contribution|2026-09': 1710632,
    'b2b|net revenues core markets|2026-04': 5206517,
    'b2b|net revenues core markets|2026-05': 5570409,
    'b2b|net revenues core markets|2026-06': 5613744,
    'b2b|net revenues core markets|2026-07': 5895315,
    'b2b|net revenues core markets|2026-08': 5606377,
    'b2b|net revenues core markets|2026-09': 5675075,
    'b2b|net revenues new markets|2026-04': 710885,
    'b2b|net revenues new markets|2026-05': 797031,
    'b2b|net revenues new markets|2026-06': 838661,
    'b2b|net revenues new markets|2026-07': 957777,
    'b2b|net revenues new markets|2026-08': 953834,
    'b2b|net revenues new markets|2026-09': 1010214,
    'b2b|air net revenue from suppliers|2026-04': 655544,
    'b2b|air net revenue from suppliers|2026-05': 717562,
    'b2b|air net revenue from suppliers|2026-06': 707487,
    'b2b|air net revenue from suppliers|2026-07': 707810,
    'b2b|air net revenue from suppliers|2026-08': 703896,
    'b2b|air net revenue from suppliers|2026-09': 741433
  };

  var lines = ['KEY | SHEET | JSON | DIFF%'];
  Object.keys(SHEET).forEach(function(k) {
    var sv = SHEET[k];
    var jv = byKey[k] || 0;
    var diff = sv ? Math.round((jv - sv) / sv * 1000) / 10 : 999;
    var flag = Math.abs(diff) > 5 ? ' *** DIFF' : ' ok';
    lines.push(k + ' | ' + sv + ' | ' + jv + ' | ' + diff + '%' + flag);
  });
  Logger.log(lines.join('\n'));
  return lines.join('\n');
}
