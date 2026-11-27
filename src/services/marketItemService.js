const catalog = require('../data/marketCatalog.json');
const codec = require('./itemSlotCodec');

/**
 * Itens do mercado (docs/SECTION_14_MARKET.md): catálogo, decodificação dos
 * 16 bytes e a regra de quem pode ser anunciado.
 *
 * Catálogo: src/data/marketCatalog.json, gerado por
 * scripts/generateMarketCatalog.js (drops das Box of Kundun +1..+5 e asas de
 * 1º nível). Itens das boxes só entram se forem excelentes; asas entram
 * sempre.
 *
 * Bytes do item (DSProtocol.cpp + macros DBI_* de zzzitem.h; a mesma leitura
 * da antiga vitrine, commit c726981^):
 *   byte 1  bit 7 skill · bits 3-6 level · bit 2 luck · bits 0-1 opção adicional
 *   byte 2  durabilidade
 *   byte 3-6 serial (big-endian)
 *   byte 7  bits 0-5 excelentes · bit 6 terceiro bit da opção adicional · bit 7 type
 *   byte 8  ancient (0xFF ou bits 0-1 = 0: não é ancient)
 *   byte 9  bit 3 opção 380 · bits 4-7 type
 *   byte 10 harmony
 * O item vai e volta como os 16 bytes originais; a decodificação é só para
 * filtro e exibição.
 */

const CATEGORIES = [
  { id: 'sword', label: 'Espadas', group: 'weapon' },
  { id: 'axe', label: 'Machados', group: 'weapon' },
  { id: 'mace', label: 'Maças', group: 'weapon' },
  { id: 'scepter', label: 'Cetros', group: 'weapon' },
  { id: 'spear', label: 'Lanças', group: 'weapon' },
  { id: 'bow', label: 'Arcos', group: 'weapon' },
  { id: 'crossbow', label: 'Bestas', group: 'weapon' },
  { id: 'staff', label: 'Cajados', group: 'weapon' },
  { id: 'shield', label: 'Escudos', group: 'shield' },
  { id: 'helm', label: 'Elmos', group: 'set' },
  { id: 'armor', label: 'Armaduras', group: 'set' },
  { id: 'pants', label: 'Calças', group: 'set' },
  { id: 'gloves', label: 'Luvas', group: 'set' },
  { id: 'boots', label: 'Botas', group: 'set' },
  { id: 'ring', label: 'Anéis', group: 'accessory' },
  { id: 'pendant', label: 'Pendants', group: 'accessory' },
  { id: 'wing', label: 'Asas', group: 'wing' },
  { id: 'jewel', label: 'Joias', group: 'jewel' },
];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

const CLASSES = [
  { id: 'dw', label: 'Dark Wizard' },
  { id: 'dk', label: 'Dark Knight' },
  { id: 'elf', label: 'Fairy Elf' },
  { id: 'mg', label: 'Magic Gladiator' },
  { id: 'dl', label: 'Dark Lord' },
];
const CLASS_IDS = CLASSES.map((c) => c.id);

const ATTACK_EXCELLENT = [
  [0x20, 'Taxa de dano excelente +10%'],
  [0x10, 'Dano +nível/20'],
  [0x08, 'Dano +2%'],
  [0x04, 'Velocidade de ataque +7'],
  [0x02, 'Vida após matar monstro +vida/8'],
  [0x01, 'Mana após matar monstro +mana/8'],
];

const DEFENSE_EXCELLENT = [
  [0x20, 'Vida máxima +4%'],
  [0x10, 'Mana máxima +4%'],
  [0x08, 'Redução de dano +4%'],
  [0x04, 'Reflete dano +5%'],
  [0x02, 'Taxa de defesa +10%'],
  [0x01, 'Zen após matar monstro +40%'],
];

const ATTACK_CATEGORIES = new Set(['sword', 'axe', 'mace', 'scepter', 'spear', 'bow', 'crossbow', 'staff', 'pendant']);
const SET_CATEGORIES = new Set(['helm', 'armor', 'pants', 'gloves', 'boots']);

function excellentTable(category) {
  if (ATTACK_CATEGORIES.has(category)) return ATTACK_EXCELLENT;
  if (category === 'wing') return null; // asas de 1º nível não têm excelentes
  if (category === 'jewel') return null;
  return DEFENSE_EXCELLENT;
}

function additionalOptionText(category, value) {
  if (value === 0 || category === 'jewel') return null;
  if (category === 'staff') return `Dano de magia adicional +${value * 4}`;
  if (category === 'shield') return `Taxa de defesa adicional +${value * 5}`;
  if (SET_CATEGORIES.has(category)) return `Defesa adicional +${value * 4}`;
  if (category === 'ring' || category === 'pendant') return `Recuperação de vida +${value}%`;
  if (category === 'wing') return `Opção adicional +${value * 4}`;
  return `Dano adicional +${value * 4}`;
}

function bitCount(value) {
  let n = 0;
  for (let v = value; v; v >>= 1) n += v & 1;
  return n;
}

function catalogEntry(group, index) {
  return catalog[`${group}:${index}`] || null;
}

/**
 * Decodifica os 16 bytes de um slot. Retorna null para slot vazio. Itens
 * fora do catálogo voltam com `inCatalog: false` e nome genérico.
 */
function decodeItem(slotBytes) {
  if (codec.isSlotEmpty(slotBytes)) return null;

  const type = codec.decodeItemType(slotBytes);
  const group = Math.floor(type / 512);
  const index = type % 512;
  const entry = catalogEntry(group, index);

  const b1 = slotBytes[1];
  const b7 = slotBytes[7];
  const b8 = slotBytes[8];
  const excMask = b7 & 0x3f;
  const category = entry ? entry.category : null;
  const table = category ? excellentTable(category) : null;
  const additionalOption = (b1 & 0x03) | ((b7 & 0x40) >> 4);

  return {
    group,
    index,
    inCatalog: Boolean(entry),
    name: entry ? entry.name : `Item ${group}:${index}`,
    category,
    width: entry ? entry.width : null,
    height: entry ? entry.height : null,
    classes: entry ? entry.classes : [],
    image: entry ? entry.image : null,
    level: (b1 >> 3) & 0x0f,
    skill: Boolean(b1 & 0x80),
    luck: Boolean(b1 & 0x04),
    additionalOption,
    additionalOptionText: category ? additionalOptionText(category, additionalOption) : null,
    excMask,
    excCount: bitCount(excMask),
    excellent: table ? table.filter(([bit]) => excMask & bit).map(([, text]) => text) : [],
    ancient: b8 !== 0xff && (b8 & 0x03) !== 0,
    durability: slotBytes[2],
    serial: slotBytes.readUInt32BE(3),
  };
}

/**
 * Motivo pelo qual o item NÃO pode ser anunciado, ou null se pode.
 * Ancient fica de fora: nenhum item do catálogo sai ancient das boxes, e
 * um ancient aqui seria algo que não avaliamos.
 */
function ineligibilityReason(decoded) {
  if (!decoded) return 'EMPTY_SLOT';
  if (!decoded.inCatalog) return 'NOT_IN_CATALOG';
  const entry = catalogEntry(decoded.group, decoded.index);
  if (entry.excellentRequired && decoded.excCount === 0) return 'NOT_EXCELLENT';
  if (decoded.ancient) return 'ANCIENT';
  return null;
}

const INELIGIBILITY_MESSAGES = {
  EMPTY_SLOT: 'Não há item neste slot.',
  NOT_IN_CATALOG: 'Este item não pode ser vendido no mercado.',
  NOT_EXCELLENT: 'Só a versão excelente deste item pode ser vendida no mercado.',
  ANCIENT: 'Itens ancient não podem ser vendidos no mercado.',
};

/** Tipos (grupo*512+índice) usáveis por uma classe — para o filtro de classe. */
function typesForClass(classId) {
  return Object.values(catalog)
    .filter((e) => e.classes.includes(classId))
    .map((e) => e.group * 512 + e.index);
}

/** Catálogo público para o front montar os filtros. */
function publicCatalog() {
  return {
    categories: CATEGORIES,
    classes: CLASSES,
    items: Object.values(catalog).map((e) => ({
      group: e.group,
      index: e.index,
      name: e.name,
      category: e.category,
      width: e.width,
      height: e.height,
      classes: e.classes,
      image: e.image,
      excellentRequired: e.excellentRequired,
    })),
  };
}

module.exports = {
  CATEGORY_IDS,
  CLASS_IDS,
  catalogEntry,
  decodeItem,
  ineligibilityReason,
  INELIGIBILITY_MESSAGES,
  typesForClass,
  publicCatalog,
};
