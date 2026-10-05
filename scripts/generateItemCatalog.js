/**
 * Gera src/data/itemCatalog.json — tudo o que o decodificador de item
 * (src/services/itemDecoder.js) precisa para mostrar um item como o jogo:
 *
 *   docs/inv/Item.txt                 nome, tamanho, se aceita skill, classes que usam
 *   docs/inv/ItemSetType.txt          item -> set ancient (link A / link B)
 *   docs/inv/ItemSetOption.txt        nome de cada set ancient
 *   docs/inv/JewelOfHarmonyOption.txt nome e valor por level de cada opção Harmony
 *
 * Os três últimos são cópias de MuServer/Data/Item do servidor (mesmo
 * conteúdo que o GameServer carrega). Rode de novo sempre que algum deles
 * mudar:
 *   node scripts/generateItemCatalog.js
 *
 * Mantido separado de generateItemDimensions.js de propósito: a loja depende
 * de itemDimensions.json e não deve mudar por causa do mercado.
 */
const fs = require('fs');
const path = require('path');

const INV_DIR = path.join(__dirname, '..', 'docs', 'inv');
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'data', 'itemCatalog.json');

// Colunas de classe no fim das linhas do Item.txt (grupos que têm "DlLe" no
// cabeçalho). Este servidor não tem Summoner.
const CLASS_KEYS = ['dw', 'dk', 'elf', 'mg', 'dl'];

function readLines(fileName) {
  return fs.readFileSync(path.join(INV_DIR, fileName), 'latin1').split(/\r?\n/);
}

/** Item.txt: blocos "<grupo>" / "//cabeçalho" / linhas / "end". */
function parseItems() {
  const items = {};
  let group = null;
  let hasClassColumns = false;

  for (const raw of readLines('Item.txt')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line === 'end') {
      group = null;
      continue;
    }
    if (group === null) {
      if (/^\d+$/.test(line)) {
        group = Number(line);
        hasClassColumns = false;
      }
      continue;
    }
    if (line.startsWith('//')) {
      hasClassColumns = /DlLe\s*$/.test(line);
      continue;
    }

    const nameMatch = line.match(/"([^"]*)"/);
    if (!nameMatch) continue;
    const before = line.slice(0, nameMatch.index).trim().split(/\s+/).map(Number);
    const after = line.slice(nameMatch.index + nameMatch[0].length).trim().split(/\s+/).map(Number);
    const [index, , skill, width, height] = before;
    if (!Number.isInteger(index)) continue;

    const entry = { name: nameMatch[1].trim(), width, height, skill: skill > 0 };
    if (hasClassColumns && after.length >= CLASS_KEYS.length) {
      const flags = after.slice(-CLASS_KEYS.length);
      entry.classes = Object.fromEntries(CLASS_KEYS.map((key, i) => [key, flags[i]]));
    }
    items[`${group}:${index}`] = entry;
  }
  return items;
}

/** ItemSetType.txt: por grupo, "<índice> <linkA> <linkB> <mixA> <mixB>". */
function parseSetTypes() {
  const setTypes = {};
  let group = null;

  for (const raw of readLines('ItemSetType.txt')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (line === '') continue;
    if (line === 'end') {
      group = null;
      continue;
    }
    const fields = line.split(/\s+/).map(Number);
    if (group === null) {
      if (fields.length === 1 && Number.isInteger(fields[0])) group = fields[0];
      continue;
    }
    const [index, linkA, linkB] = fields;
    if (!Number.isInteger(index)) continue;
    setTypes[`${group}:${index}`] = [linkA || 0, linkB || 0];
  }
  return setTypes;
}

/** ItemSetOption.txt: "<link> "<nome>" ...". */
function parseSetNames() {
  const names = {};
  for (const raw of readLines('ItemSetOption.txt')) {
    const match = raw.match(/^\s*(\d+)\s+"([^"]*)"/);
    if (match) names[match[1]] = match[2].trim();
  }
  return names;
}

/**
 * JewelOfHarmonyOption.txt: blocos 1 (armas), 2 (cajados), 3 (defesa);
 * linha "<índice> "<nome>" <peso> <minLvl> <valor0> <zen0> <valor1> <zen1> ...".
 */
function parseHarmony() {
  const harmony = {};
  let group = null;

  for (const raw of readLines('JewelOfHarmonyOption.txt')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) continue;
    if (line === 'end') {
      group = null;
      continue;
    }
    if (group === null) {
      if (/^\d+$/.test(line)) {
        group = line;
        harmony[group] = {};
      }
      continue;
    }
    const nameMatch = line.match(/^(\d+)\s+"([^"]*)"/);
    if (!nameMatch) continue;
    const rest = line.slice(nameMatch[0].length).trim().split(/\s+/).map(Number);
    const values = [];
    for (let i = 2; i < rest.length; i += 2) values.push(rest[i]);
    harmony[group][nameMatch[1]] = { name: nameMatch[2].trim(), values };
  }
  return harmony;
}

function main() {
  const catalog = {
    items: parseItems(),
    setTypes: parseSetTypes(),
    setNames: parseSetNames(),
    harmony: parseHarmony(),
  };

  const counts = Object.fromEntries(Object.entries(catalog).map(([k, v]) => [k, Object.keys(v).length]));
  if (counts.items === 0 || counts.setNames === 0 || counts.harmony === 0) {
    throw new Error(`Parse incompleto: ${JSON.stringify(counts)} — algum arquivo mudou de formato?`);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(catalog, null, 1) + '\n');
  console.log(`Gerado ${OUTPUT_PATH}: ${JSON.stringify(counts)}`);
}

main();
