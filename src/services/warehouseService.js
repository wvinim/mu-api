const AppError = require('../utils/AppError');
const codec = require('./itemSlotCodec');

/**
 * Lógica de inserção de item no `Items` (VARBINARY(1920)) da tabela
 * `warehouse` (baú da conta) — formato validado empiricamente em
 * 2026-09-17, ver docs/WAREHOUSE_BYTE_FORMAT.md. Mesmo layout de 16
 * bytes/slot do `Character.Inventory` (docs/INVENTORY_BYTE_FORMAT.md),
 * mas grade maior (8x15 = 120 slots) e SEM faixa de equipamento a excluir
 * — todo o baú é área de armazenamento.
 */
const { ITEM_DB_BYTE } = codec;
const WAREHOUSE_WIDTH = 8;
const WAREHOUSE_HEIGHT = 15;
const WAREHOUSE_SIZE = WAREHOUSE_WIDTH * WAREHOUSE_HEIGHT; // 120 slots = 1920 bytes
const WAREHOUSE_START_SLOT = 0;

/**
 * Baú do mercado (`/mercado` no jogo, mesma troca do `/bau`). Enquanto ele
 * é o baú ativo, a loja não grava nada no baú — senão o item comprado cairia
 * na vitrine pública. Ver docs/SECTION_10_MARKET.md.
 */
const SHOWCASE_VAULT_ID = 200;

function assertNotShowcaseVault(vaultId) {
  if (vaultId === SHOWCASE_VAULT_ID) {
    throw new AppError(
      409,
      'WAREHOUSE_IS_SHOWCASE',
      'Seu baú ativo é o baú do mercado. Troque de baú com /bau no jogo antes de comprar.',
    );
  }
}

/** Buffer de baú vazio (120 slots de 0xFF) — usado ao criar a linha de uma conta que nunca abriu o baú no jogo. */
function emptyItemsBuffer() {
  return Buffer.alloc(ITEM_DB_BYTE * WAREHOUSE_SIZE, 0xff);
}

function buildWarehouseGrid(itemsBuffer) {
  return codec.buildOccupancyGrid(itemsBuffer, { startSlot: WAREHOUSE_START_SLOT, width: WAREHOUSE_WIDTH, height: WAREHOUSE_HEIGHT });
}

function assertGridIsReliable(unknownItems) {
  if (unknownItems.length > 0) {
    throw new AppError(
      409,
      'WAREHOUSE_UNKNOWN_ITEM',
      'O baú desta conta tem um item que não reconhecemos (fora da tabela de dimensões) — abortando para não arriscar sobrescrever ou perder itens.',
    );
  }
}

/** Usado para validar espaço ANTES de debitar créditos (0 a N itens de uma vez). */
function countEmptyWarehouseSlots(itemsBuffer) {
  const { occupied, unknownItems } = buildWarehouseGrid(itemsBuffer);
  assertGridIsReliable(unknownItems);
  return occupied.filter((cell) => !cell).length;
}

function findEmptyWarehouseSlot(itemsBuffer) {
  const { occupied, unknownItems } = buildWarehouseGrid(itemsBuffer);
  assertGridIsReliable(unknownItems);
  const rel = occupied.indexOf(false);
  return rel === -1 ? -1 : WAREHOUSE_START_SLOT + rel;
}

function assertValidBuffer(itemsBuffer) {
  if (!Buffer.isBuffer(itemsBuffer) || itemsBuffer.length !== ITEM_DB_BYTE * WAREHOUSE_SIZE) {
    throw new AppError(500, 'INVALID_WAREHOUSE_FORMAT', 'Formato do baú desta conta não reconhecido — abortando para não corromper dados.');
  }
}

/**
 * Insere um item no baú (slots 0-119). Retorna um NOVO buffer (não muta o
 * original) e o índice do slot usado. `itemSpec` precisa ser 1x1 (ver
 * `itemSlotCodec.assertRedeemableAsSimpleItem` — chame antes de debitar Cash).
 */
function insertItemIntoWarehouse(itemsBuffer, itemSpec) {
  assertValidBuffer(itemsBuffer);

  const slotIndex = findEmptyWarehouseSlot(itemsBuffer);
  if (slotIndex === -1) {
    throw new AppError(409, 'WAREHOUSE_FULL', 'Baú cheio. Libere espaço antes de resgatar este item.');
  }

  const itemSlotBytes = codec.makeSimpleItemSlot(itemSpec);
  const newBuffer = Buffer.from(itemsBuffer);
  itemSlotBytes.copy(newBuffer, slotIndex * ITEM_DB_BYTE);

  return { buffer: newBuffer, slot: slotIndex };
}

/**
 * Insere vários itens de uma vez (pacote/bundle) — cada entrada de
 * `itemSpecs` ocupa seu próprio slot do baú, sempre 1x1. Tudo ou nada: se
 * faltar espaço para QUALQUER item da lista, lança antes de devolver nada
 * — quem chamar não deve persistir nem debitar em caso de erro.
 */
function insertItemsIntoWarehouse(itemsBuffer, itemSpecs) {
  assertValidBuffer(itemsBuffer);

  const newBuffer = Buffer.from(itemsBuffer);
  const slots = [];

  for (const itemSpec of itemSpecs) {
    const slotIndex = findEmptyWarehouseSlot(newBuffer);
    if (slotIndex === -1) {
      throw new AppError(409, 'WAREHOUSE_FULL', 'Baú cheio. Espaço insuficiente para todos os itens do pacote — nada foi alterado.');
    }
    const itemSlotBytes = codec.makeSimpleItemSlot(itemSpec);
    itemSlotBytes.copy(newBuffer, slotIndex * ITEM_DB_BYTE);
    slots.push(slotIndex);
  }

  return { buffer: newBuffer, slots };
}

module.exports = {
  ITEM_DB_BYTE,
  WAREHOUSE_SIZE,
  WAREHOUSE_WIDTH,
  WAREHOUSE_HEIGHT,
  WAREHOUSE_START_SLOT,
  SHOWCASE_VAULT_ID,
  assertNotShowcaseVault,
  emptyItemsBuffer,
  buildWarehouseGrid,
  countEmptyWarehouseSlots,
  findEmptyWarehouseSlot,
  insertItemIntoWarehouse,
  insertItemsIntoWarehouse,
  assertRedeemableAsSimpleItem: codec.assertRedeemableAsSimpleItem,
};
