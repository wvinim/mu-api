// O banco do MU recusou THROW ("Incorrect syntax near 'THROW'") — o
// compatibility level do banco é antigo (< 110). THROW não pode aparecer em
// nenhum SQL da API; use ROLLBACK TRANSACTION + RAISERROR + RETURN.
const fs = require('fs');
const path = require('path');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

const srcDir = path.join(__dirname, '..', 'src');

test.each(jsFiles(srcDir).map((file) => [path.relative(srcDir, file), file]))(
  'src/%s não usa THROW em SQL',
  (name, file) => {
    const offending = fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^\s*THROW\s+\d/.test(line));
    expect(offending).toEqual([]);
  },
);

test('a checagem detecta THROW de verdade', () => {
  expect(/^\s*THROW\s+\d/.test("        THROW 50002, 'x', 1;")).toBe(true);
});
