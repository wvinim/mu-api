/**
 * Monta os 16 bytes de um item como o jogo grava (ver
 * src/services/marketItemService.js para o layout).
 */
function makeItemBytes({ group, index, level = 0, exc = 0, skill = false, luck = false, addOption = 0, serial = 0, ancient = false }) {
  const type = group * 512 + index;
  const buf = Buffer.alloc(16, 0x00);
  buf[0] = type & 0xff;
  buf[1] = (skill ? 0x80 : 0) | ((level & 0x0f) << 3) | (luck ? 0x04 : 0) | (addOption & 0x03);
  buf[2] = 255;
  buf.writeUInt32BE(serial, 3);
  buf[7] = (type & 0x100 ? 0x80 : 0) | ((addOption & 0x04) << 4) | (exc & 0x3f);
  buf[8] = ancient ? 0x05 : 0xff;
  buf[9] = ((type & 0x1e00) >> 5) & 0xf0;
  buf[10] = 0;
  return buf;
}

/** Baú de 120 slots vazios com os itens dados ({ slot: bytes }). */
function makeVault(itemsBySlot = {}) {
  const buf = Buffer.alloc(1920, 0xff);
  for (const [slot, bytes] of Object.entries(itemsBySlot)) bytes.copy(buf, Number(slot) * 16);
  return buf;
}

module.exports = { makeItemBytes, makeVault };
