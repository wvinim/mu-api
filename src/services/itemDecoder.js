const catalog = require('../data/itemCatalog.json');
const codec = require('./itemSlotCodec');

/**
 * Decodifica os 16 bytes de um item salvo (warehouse/Extwarehouse/Inventory)
 * em algo exibível, seguindo exatamente o que o GameServer faz ao carregar o
 * item do banco (DSProtocol.cpp, DGGetWarehouseList + macros DBI_* em
 * zzzitem.h):
 *
 *   byte 1  bit 7 skill · bits 3-6 level · bit 2 luck · bits 0-1 opção adicional
 *   byte 2  durabilidade (ou quantidade empilhada)
 *   byte 3-6 serial (big-endian)
 *   byte 7  bits 0-5 excelentes · bit 6 terceiro bit da opção adicional · bit 7 type
 *   byte 8  set ancient (bits 0-1 tipo, bits 2-3 bônus de stamina)
 *   byte 9  bit 3 opção 380 · bits 4-7 type
 *   byte 10 Harmony (bits 4-7 opção, bits 0-3 level)
 *
 * Bits das excelentes conferidos em zzzitem.cpp (CItem::IsExt*). Os textos
 * das opções de asa (grupo 12, 13:30) seguem o padrão do Season 2.5 e devem
 * ser conferidos com o tooltip do jogo.
 */

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

const WING_EXCELLENT = [
  [0x01, 'Vida +50+5×nível'],
  [0x02, 'Mana +50+5×nível'],
  [0x04, 'Ignora 3% da defesa do inimigo'],
  [0x08, 'Stamina +50+5×nível'],
  [0x10, 'Velocidade de ataque +5'],
];

const PENDANTS = new Set([12, 13, 25, 26, 27, 28]);
const RINGS = new Set([8, 9, 10, 20, 21, 22, 23, 24]);

/** Categoria usada no filtro da busca e para escolher a tabela de excelentes. */
function categoryOf(group, index) {
  switch (group) {
    case 0: return 'espada';
    case 1: return 'machado';
    case 2: return 'maca';
    case 3: return 'lanca';
    case 4: return index === 7 || index === 15 ? 'outros' : 'arco';
    case 5: return 'cajado';
    case 6: return 'escudo';
    case 7: return 'elmo';
    case 8: return 'armadura';
    case 9: return 'calca';
    case 10: return 'luva';
    case 11: return 'bota';
    case 12: return index <= 6 ? 'asa' : 'outros';
    case 13:
      if (index === 30) return 'asa';
      if (PENDANTS.has(index)) return 'colar';
      if (RINGS.has(index)) return 'anel';
      return 'outros';
    case 14: {
      const info = catalog.items[`14:${index}`];
      return info && /^Jewel of|Gemstone/.test(info.name) ? 'joia' : 'outros';
    }
    default: return 'outros';
  }
}

const ATTACK_CATEGORIES = new Set(['espada', 'machado', 'maca', 'lanca', 'arco', 'cajado', 'colar']);
const DEFENSE_CATEGORIES = new Set(['escudo', 'elmo', 'armadura', 'calca', 'luva', 'bota', 'anel']);

function excellentTable(category) {
  if (ATTACK_CATEGORIES.has(category)) return ATTACK_EXCELLENT;
  if (DEFENSE_CATEGORIES.has(category)) return DEFENSE_EXCELLENT;
  if (category === 'asa') return WING_EXCELLENT;
  return null;
}

function additionalOptionText(category, value) {
  if (value === 0) return null;
  switch (category) {
    case 'cajado': return `Dano de magia adicional +${value * 4}`;
    case 'escudo': return `Taxa de defesa adicional +${value * 5}`;
    case 'elmo':
    case 'armadura':
    case 'calca':
    case 'luva':
    case 'bota': return `Defesa adicional +${value * 4}`;
    case 'anel':
    case 'colar': return `Recuperação de vida +${value}%`;
    case 'asa': return `Opção adicional +${value * 4}`;
    default: return `Dano adicional +${value * 4}`;
  }
}

/** Tabela de Harmony do GameServer: 1 = armas, 2 = cajados, 3 = defesa. */
function harmonyTableOf(category) {
  if (category === 'cajado') return '2';
  if (['espada', 'machado', 'maca', 'lanca', 'arco'].includes(category)) return '1';
  if (DEFENSE_CATEGORIES.has(category) && category !== 'anel') return '3';
  return null;
}

/**
 * @returns {object|null} item decodificado, ou null para slot vazio.
 * Item que não está no catálogo volta com `known: false` (nome genérico),
 * nunca lança — uma vitrine com um item novo não pode quebrar a página.
 */
function decodeItem(slotBytes) {
  if (codec.isSlotEmpty(slotBytes)) return null;

  const type = codec.decodeItemType(slotBytes);
  const group = Math.floor(type / 512);
  const index = type % 512;
  const key = `${group}:${index}`;
  const info = catalog.items[key];
  const category = categoryOf(group, index);

  const b1 = slotBytes[1];
  const b7 = slotBytes[7];
  const b8 = slotBytes[8];
  const b10 = slotBytes[10];

  const level = (b1 >> 3) & 0x0f;
  const additional = (b1 & 0x03) | ((b7 & 0x40) >> 4);
  const excellentBits = b7 & 0x3f;
  const table = excellentTable(category);
  const excellent = table ? table.filter(([bit]) => excellentBits & bit).map(([, text]) => text) : [];

  let ancient = null;
  const setTier = b8 === 0xff ? 0 : b8 & 0x03;
  if (setTier === 1 || setTier === 2) {
    const link = (catalog.setTypes[key] || [])[setTier - 1];
    const stamina = (b8 >> 2) & 0x03;
    ancient = {
      setName: (link && catalog.setNames[String(link)]) || null,
      staminaBonus: stamina === 1 ? 5 : stamina === 2 ? 10 : 0,
    };
  }

  let harmony = null;
  const harmonyTable = harmonyTableOf(category);
  if (harmonyTable && b10 !== 0 && b10 !== 0xff) {
    const option = catalog.harmony[harmonyTable][String(b10 >> 4)];
    if (option) {
      const harmonyLevel = b10 & 0x0f;
      harmony = { name: option.name, level: harmonyLevel, value: option.values[harmonyLevel] ?? null };
    }
  }

  return {
    group,
    index,
    known: Boolean(info),
    name: info ? info.name : `Item ${group}:${index}`,
    category,
    width: info ? info.width : 1,
    height: info ? info.height : 1,
    classes: info && info.classes ? info.classes : null,
    level,
    skill: Boolean(b1 & 0x80),
    luck: Boolean(b1 & 0x04),
    additionalOption: additional,
    additionalOptionText: additionalOptionText(category, additional),
    excellent,
    ancient,
    harmony,
    option380: Boolean(slotBytes[9] & 0x08),
    durability: slotBytes[2],
    serial: slotBytes.readUInt32BE(3),
  };
}

/**
 * Decodifica um container inteiro (baú = 120 slots). Retorna só os slots
 * ocupados, cada um com sua posição (`slot`, `x`, `y`) na grade.
 */
function decodeContainer(buffer, { width = 8, slots = 120 } = {}) {
  const result = [];
  if (!buffer) return result;
  for (let slot = 0; slot < slots; slot++) {
    const offset = slot * codec.ITEM_DB_BYTE;
    if (offset + codec.ITEM_DB_BYTE > buffer.length) break;
    const item = decodeItem(buffer.subarray(offset, offset + codec.ITEM_DB_BYTE));
    if (item) result.push({ slot, x: slot % width, y: Math.floor(slot / width), ...item });
  }
  return result;
}

module.exports = { decodeItem, decodeContainer, categoryOf };
