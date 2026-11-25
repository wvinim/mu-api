/**
 * Gera src/data/marketCatalog.json: a lista de itens que podem ser
 * anunciados no mercado (docs/SECTION_14_MARKET.md, decisão 6).
 *
 * Fontes:
 *   - docs/bags/EventItembag8..12.txt  -> drops das Box of Kundun +1..+5
 *     (só a cópia excelente pode ser anunciada)
 *   - WINGS abaixo                      -> asas de 1º nível (qualquer cópia)
 *   - Item.txt do SERVIDOR              -> nome, tamanho (X/Y) e classes
 *     (5 últimas colunas: DW, DK, Elf, MG, DL; valor > 0 = pode usar).
 *     docs/inv/Item.txt está defasado; por padrão lê a cópia do servidor
 *     em ../MuPRO/server/Data/Item/Item.txt (ou o caminho passado como 1º argumento).
 *   - docs/imgs_shop/<pasta>/<Nome>.jpg -> imagem (casamento por nome
 *     normalizado; ALIASES cobre os nomes que diferem do servidor).
 *
 * Rode de novo quando as bags, as asas liberadas ou as imagens mudarem:
 *   node scripts/generateMarketCatalog.js [caminho/do/Item.txt]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ITEM_TXT = process.argv[2] || path.join(ROOT, '..', 'MuPRO', 'server', 'Data', 'Item', 'Item.txt');
const BAGS_DIR = path.join(ROOT, 'docs', 'bags');
const IMG_DIR = path.join(ROOT, 'docs', 'imgs_shop');
const OUTPUT = path.join(ROOT, 'src', 'data', 'marketCatalog.json');

// Box of Kundun +1..+5 = EventItembag8..12 (Event.cpp, boxtype 8..12).
const BAGS = { 1: 8, 2: 9, 3: 10, 4: 11, 5: 12 };

// Asas liberadas no mercado (decisão 2026-11-24: só 1º nível).
const WINGS = ['12:0', '12:1', '12:2'];

// Nome no servidor -> nome do arquivo de imagem, quando diferem.
const ALIASES = {
  'Angélica Staff': 'Angelic Staff',
  'Pendant of Lighting': 'Pendant of Lightning',
  'Wings of Elf': 'Wing of Elf',
  'Wings of Heaven': 'Wing of Heaven',
  'Wings of Satan': 'Wing of Satan',
};

const CLASS_CODES = ['dw', 'dk', 'elf', 'mg', 'dl'];
const SET_PIECES = { 7: 'helm', 8: 'armor', 9: 'pants', 10: 'gloves', 11: 'boots' };
const PENDANTS = new Set([12, 13, 25, 26, 27, 28]);

function parseItemTxt(content) {
  const items = {};
  let group = null;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'end') { group = null; continue; }
    if (group === null) {
      if (/^\d+$/.test(line)) group = Number(line);
      continue;
    }
    if (line.startsWith('//')) continue;
    const nameMatch = line.match(/"([^"]*)"/);
    if (!nameMatch) continue;
    const before = line.slice(0, nameMatch.index).trim().split(/\s+/).map(Number);
    const after = line.slice(nameMatch.index + nameMatch[0].length).trim().split(/\s+/).map(Number);
    const classFlags = after.slice(-5);
    items[`${group}:${before[0]}`] = {
      name: nameMatch[1].trim(),
      width: before[3],
      height: before[4],
      classes: CLASS_CODES.filter((_, i) => classFlags[i] > 0),
    };
  }
  return items;
}

function parseBag(file) {
  const keys = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*(\d+)\s+(\d+)\s+\d+/);
    if (m) keys.push(`${m[1]}:${m[2]}`);
  }
  return keys;
}

function categoryOf(group, index, name) {
  switch (group) {
    case 0: return 'sword';
    case 1: return 'axe';
    case 2: return index >= 8 ? 'scepter' : 'mace';
    case 3: return 'spear';
    case 4: return /crossbow/i.test(name) ? 'crossbow' : 'bow';
    case 5: return 'staff';
    case 6: return 'shield';
    case 12: return 'wing';
    case 13: return PENDANTS.has(index) ? 'pendant' : 'ring';
    default: return SET_PIECES[group] || null;
  }
}

function imageIndex() {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const index = {};
  for (const dir of fs.readdirSync(IMG_DIR)) {
    const full = path.join(IMG_DIR, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full)) {
      index[norm(file.replace(/\.\w+$/, ''))] = `${dir}/${file}`;
    }
  }
  return (name) => index[norm(ALIASES[name] || name)] || null;
}

function main() {
  const itemTxt = parseItemTxt(fs.readFileSync(ITEM_TXT, 'latin1'));
  const findImage = imageIndex();
  const entries = {};
  const problems = [];

  const add = (key, box, excellentRequired) => {
    if (entries[key]) { problems.push(`${key} aparece mais de uma vez`); return; }
    const info = itemTxt[key];
    if (!info) { problems.push(`${key} não existe no Item.txt`); return; }
    const [group, index] = key.split(':').map(Number);
    const category = categoryOf(group, index, info.name);
    if (!category) { problems.push(`${key} ${info.name}: categoria fora do mercado`); return; }
    const image = findImage(info.name);
    if (!image) problems.push(`${key} ${info.name}: sem imagem`);
    entries[key] = {
      group,
      index,
      name: info.name,
      category,
      width: info.width,
      height: info.height,
      classes: info.classes,
      box,
      excellentRequired,
      image,
    };
  };

  for (const [box, bag] of Object.entries(BAGS)) {
    for (const key of parseBag(path.join(BAGS_DIR, `EventItembag${bag}.txt`))) add(key, Number(box), true);
  }
  for (const key of WINGS) add(key, null, false);

  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }

  const sorted = Object.fromEntries(
    Object.entries(entries).sort(([, a], [, b]) => a.group - b.group || a.index - b.index),
  );
  fs.writeFileSync(OUTPUT, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Gerado ${path.relative(ROOT, OUTPUT)} com ${Object.keys(sorted).length} itens.`);
}

main();
