const AppError = require('../utils/AppError');
const showcaseRepository = require('../db/showcaseRepository');
const accountsRepository = require('../db/accountsRepository');
const itemDecoder = require('../services/itemDecoder');
const { SHOWCASE_VAULT_ID } = require('../services/warehouseService');
const TtlCache = require('../utils/ttlCache');

// A vitrine guardada só muda quando o jogador troca de baú no jogo; 60 s de
// cache protege o banco do jogo de recarregamentos sem atrasar nada visível.
const publicCache = new TtlCache(60);

/**
 * Itens que não aparecem na vitrine mesmo se estiverem no baú:
 * pets com dados guardados por serial em outra tabela (o level/exp não vai
 * junto numa troca) e o anel de GM.
 */
const HIDDEN_ITEMS = new Set(['13:4', '13:5', '13:42']);

function visibleItems(buffer) {
  return itemDecoder.decodeContainer(buffer).filter((item) => !HIDDEN_ITEMS.has(`${item.group}:${item.index}`));
}

/** GET /showcase/:name — vitrine pública do personagem de contato. */
async function getByCharacter(req, res, next) {
  try {
    const { name } = req.params;
    const cacheKey = name.toLowerCase();
    let showcase = publicCache.get(cacheKey);

    if (!showcase) {
      const contact = await showcaseRepository.findContactByCharacter(name);
      const stored = contact ? await showcaseRepository.findStoredShowcase(contact.AccountId) : null;
      if (!contact || !contact.CharacterName || !stored) {
        throw new AppError(404, 'NOT_FOUND', 'Este personagem não tem vitrine no mercado.');
      }
      showcase = {
        accountId: contact.AccountId,
        character: contact.CharacterName,
        storedAt: stored.storedAt,
        items: visibleItems(stored.items),
      };
      publicCache.set(cacheKey, showcase);
    }

    const online = await accountsRepository.isAccountOnline(showcase.accountId);
    res.json({
      character: showcase.character,
      online,
      storedAt: showcase.storedAt,
      items: showcase.items,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /showcase/me — a própria vitrine, incluindo se está em edição no jogo. */
async function getMine(req, res, next) {
  try {
    const { username } = req.user;
    const [contact, stored, activeVaultId] = await Promise.all([
      showcaseRepository.findContactByAccount(username),
      showcaseRepository.findStoredShowcase(username),
      showcaseRepository.findActiveVaultId(username),
    ]);

    res.json({
      character: contact ? contact.CharacterName : null,
      // Ativa no jogo = em edição: não aparece no site até o jogador trocar de baú.
      editing: activeVaultId === SHOWCASE_VAULT_ID,
      storedAt: stored ? stored.storedAt : null,
      items: stored ? visibleItems(stored.items) : [],
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getByCharacter, getMine, HIDDEN_ITEMS };
