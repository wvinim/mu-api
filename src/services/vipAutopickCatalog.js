const OPTIONS = require('../data/vipAutopickOptions.json');

/**
 * Lista fechada de itens selecionáveis pro autopick do Mega Vip (tier 3),
 * confirmada item a item contra docs/inv/Item.txt e testes reais em
 * conta de teste (ver docs/SECTION_9_VIP.md — "Box of Kundun +N" reaproveita
 * o item "Box of Luck" com o level indicando a variante, mesmo padrão já
 * visto em "Bundle of Jewel of Bless" no docs/INVENTORY_BYTE_FORMAT.md).
 * NÃO adivinhe grupo/índice/level de item novo aqui sem validar named.
 */
const SUPER_VIP_FIXED_KEYS = ['jewel_of_soul', 'jewel_of_bless'];

function findOption(itemGroup, itemIndex, itemLevel) {
  return (
    OPTIONS.find((o) => o.itemGroup === itemGroup && o.itemIndex === itemIndex && o.itemLevel === itemLevel) || null
  );
}

function isAllowedAutopickItem(itemGroup, itemIndex, itemLevel) {
  return findOption(itemGroup, itemIndex, itemLevel) !== null;
}

function getSuperVipFixedItems() {
  return OPTIONS.filter((o) => SUPER_VIP_FIXED_KEYS.includes(o.key)).map(({ itemGroup, itemIndex, itemLevel }) => ({
    itemGroup,
    itemIndex,
    itemLevel,
  }));
}

module.exports = {
  OPTIONS,
  findOption,
  isAllowedAutopickItem,
  getSuperVipFixedItems,
};
