const AppError = require('../utils/AppError');
const env = require('../config/env');
const logger = require('../utils/logger');
const marketRepository = require('../db/marketRepository');
const accountsRepository = require('../db/accountsRepository');
const auditLog = require('../db/auditLogRepository');
const marketItems = require('../services/marketItemService');
const warehouseService = require('../services/warehouseService');

/**
 * Mercado entre jogadores — docs/SECTION_14_MARKET.md.
 *
 * Fluxo de toda escrita: lê o baú (sem trava), calcula o baú novo em
 * memória e chama a procedure, que grava só se o baú ainda for o mesmo.
 * Se o baú mudou no meio (Result 3), relê e tenta de novo.
 */

const MAX_ATTEMPTS = 3;
const LISTING_LIMIT = 10;
const FEE_PERCENT = 10;
const ITEM_BYTES = 16;
const EMPTY_SLOT = Buffer.alloc(ITEM_BYTES, 0xff);

// Códigos de retorno das procedures (migration 0016).
const RESULT_ERRORS = {
  1: [409, 'ACCOUNT_ONLINE', 'Saia do jogo e aguarde 2 minutos antes de usar o mercado.'],
  2: [409, 'VAULT_NOT_AVAILABLE', 'Baú não encontrado. Abra o baú no jogo pelo menos uma vez e tente de novo.'],
  3: [409, 'VAULT_CHANGED', 'O baú mudou enquanto a operação acontecia. Tente de novo.'],
  4: [409, 'LISTING_LIMIT', `Você já tem ${LISTING_LIMIT} anúncios. Retire ou espere vender algum antes de anunciar outro.`],
  5: [409, 'LISTING_UNAVAILABLE', 'Este anúncio não está mais disponível.'],
  6: [402, 'INSUFFICIENT_CREDITS', 'Gold insuficiente.'],
  7: [500, 'MARKET_INVALID_OPERATION', 'Não foi possível concluir a operação. Nada foi alterado.'],
  8: [409, 'OWN_LISTING', 'Você não pode comprar o seu próprio anúncio.'],
};

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

/** Mercado desligado: só as contas de teste passam (MARKET_ENABLED / MARKET_TESTERS). */
function requireMarketAccess(req, res, next) {
  if (env.market.enabled || env.market.testers.includes(req.user?.username)) return next();
  return next(new AppError(403, 'MARKET_DISABLED', 'O mercado ainda não está disponível.'));
}

function resultError(result) {
  const entry = RESULT_ERRORS[result];
  if (entry) return new AppError(...entry);
  return new AppError(500, 'MARKET_UNEXPECTED_RESULT', 'Não foi possível concluir a operação. Nada foi alterado.');
}

/**
 * Trava ocupada (1222, LOCK_TIMEOUT da procedure) ou deadlock (1205, a
 * procedure é sempre a vítima): o mercado cedeu para o jogo. Nada mudou.
 */
function isBusyError(err) {
  return err && (err.number === 1222 || err.number === 1205);
}

async function withRetry(operation) {
  let lastResult;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      lastResult = await operation();
    } catch (err) {
      if (isBusyError(err)) {
        throw new AppError(503, 'MARKET_BUSY', 'O servidor está ocupado. Tente de novo em alguns segundos.');
      }
      throw err;
    }
    if (lastResult.Result !== 3) return lastResult;
  }
  return lastResult;
}

/** Baú como Buffer de 1920 bytes; NULL (baú nunca usado) vira baú vazio. */
function vaultBuffer(vault) {
  const items = vault.items ? Buffer.from(vault.items) : warehouseService.emptyItemsBuffer();
  if (items.length !== ITEM_BYTES * warehouseService.WAREHOUSE_SIZE) {
    throw new AppError(500, 'INVALID_WAREHOUSE_FORMAT', 'Formato do baú não reconhecido. Nada foi alterado.');
  }
  return items;
}

async function loadVault(accountId, vaultId) {
  const vault = await marketRepository.findVault(accountId, vaultId);
  if (!vault) throw new AppError(404, 'VAULT_NOT_FOUND', 'Baú não encontrado.');
  if (vault.duplicated) {
    throw new AppError(409, 'VAULT_NOT_AVAILABLE', 'Seu baú precisa de ajuste pela equipe antes de usar o mercado. Abra um ticket.');
  }
  return vault;
}

function itemDetails(itemBytes) {
  const decoded = marketItems.decodeItem(Buffer.from(itemBytes));
  if (!decoded) return null;
  return {
    name: decoded.name,
    group: decoded.group,
    index: decoded.index,
    category: decoded.category,
    width: decoded.width,
    height: decoded.height,
    classes: decoded.classes,
    image: decoded.image,
    level: decoded.level,
    skill: decoded.skill,
    luck: decoded.luck,
    additionalOption: decoded.additionalOption,
    additionalOptionText: decoded.additionalOptionText,
    excellentCount: decoded.excCount,
    excellent: decoded.excellent,
    durability: decoded.durability,
  };
}

function publicListing(row) {
  return {
    id: Number(row.id),
    price: row.price,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    item: itemDetails(row.itemBytes),
  };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

function getCatalog(req, res) {
  res.json({
    ...marketItems.publicCatalog(),
    rules: {
      minPrice: 10,
      maxPrice: 10000,
      feePercent: FEE_PERCENT,
      listingLimit: LISTING_LIMIT,
      listingDays: 7,
    },
  });
}

/** Baús da conta com os itens e se cada um pode ser anunciado. */
async function getVaults(req, res, next) {
  try {
    const username = req.user.username;
    const [{ active, stored }, online, activeListings] = await Promise.all([
      marketRepository.listVaults(username),
      accountsRepository.isAccountOnline(username),
      marketRepository.countActiveBySeller(username),
    ]);

    const vaults = [...active, ...stored].map((vault) => {
      const items = [];
      if (vault.items) {
        const buffer = Buffer.from(vault.items);
        for (let slot = 0; slot < warehouseService.WAREHOUSE_SIZE; slot++) {
          const bytes = buffer.subarray(slot * ITEM_BYTES, (slot + 1) * ITEM_BYTES);
          const decoded = marketItems.decodeItem(bytes);
          if (!decoded) continue;
          const reason = marketItems.ineligibilityReason(decoded);
          items.push({
            slot,
            x: slot % warehouseService.WAREHOUSE_WIDTH,
            y: Math.floor(slot / warehouseService.WAREHOUSE_WIDTH),
            sellable: !reason,
            notSellableReason: reason ? marketItems.INELIGIBILITY_MESSAGES[reason] : null,
            item: itemDetails(bytes),
          });
        }
      }
      return { vaultId: vault.vaultId, active: !vault.stored, items };
    });
    vaults.sort((a, b) => a.vaultId - b.vaultId);

    res.json({
      online,
      // A conta com mais de uma linha de baú ativo não pode usar o mercado.
      vaultsAvailable: active.length <= 1,
      listings: { active: activeListings, limit: LISTING_LIMIT },
      vaults,
    });
  } catch (err) {
    next(err);
  }
}

async function searchListings(req, res, next) {
  try {
    const { category, class: classId, group, index, minLevel, minExc, skill, luck, minPrice, maxPrice, q, sort, page, limit } =
      req.query;
    const filters = {
      categories: category,
      types: classId ? marketItems.typesForClass(classId) : undefined,
      itemGroup: group,
      itemIndex: index,
      minLevel,
      minExc,
      skill,
      luck,
      minPrice,
      maxPrice,
      q,
    };
    const { total, rows } = await marketRepository.searchListings(filters, { page, limit, sort });
    res.json({ page, limit, total, listings: rows.map(publicListing) });
  } catch (err) {
    next(err);
  }
}

async function getListing(req, res, next) {
  try {
    const row = await marketRepository.findListingById(req.params.id);
    if (!row || row.status !== 'active' || row.expired) {
      throw new AppError(404, 'NOT_FOUND', 'Anúncio não encontrado.');
    }
    res.json({ ...publicListing(row), mine: row.sellerAccount === req.user.username });
  } catch (err) {
    next(err);
  }
}

async function getMyListings(req, res, next) {
  try {
    const { state, page, limit } = req.query;
    const rows = await marketRepository.findBySeller(req.user.username, { state, page, limit });
    res.json({
      page,
      limit,
      total: rows.length ? rows[0].total : 0,
      listings: rows.map((row) => ({
        ...publicListing(row),
        state: row.state,
        closedAt: row.closedAt,
        sourceVault: row.sourceVault,
        destVault: row.destVault,
        // Venda: quem comprou e quanto o vendedor recebeu (após a taxa).
        ...(row.state === 'sold' && { buyerName: row.buyerName, received: row.sellerReceived, fee: row.fee }),
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function getMyPurchases(req, res, next) {
  try {
    const { page, limit } = req.query;
    const rows = await marketRepository.findByBuyer(req.user.username, { page, limit });
    res.json({
      page,
      limit,
      total: rows.length ? rows[0].total : 0,
      purchases: rows.map((row) => ({
        ...publicListing(row),
        boughtAt: row.closedAt,
        sellerName: row.sellerName,
        destVault: row.destVault,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

async function createListing(req, res, next) {
  const username = req.user.username;
  const { vaultId, slot, price } = req.body;
  try {
    let created = null;
    const result = await withRetry(async () => {
      const vault = await loadVault(username, vaultId);
      if (!vault.items) throw new AppError(422, 'ITEM_NOT_SELLABLE', marketItems.INELIGIBILITY_MESSAGES.EMPTY_SLOT);
      const oldItems = vaultBuffer(vault);
      const itemBytes = Buffer.from(oldItems.subarray(slot * ITEM_BYTES, (slot + 1) * ITEM_BYTES));
      const decoded = marketItems.decodeItem(itemBytes);
      const reason = marketItems.ineligibilityReason(decoded);
      if (reason) throw new AppError(422, 'ITEM_NOT_SELLABLE', marketItems.INELIGIBILITY_MESSAGES[reason]);

      const newItems = Buffer.from(oldItems);
      EMPTY_SLOT.copy(newItems, slot * ITEM_BYTES);
      created = { decoded, stored: vault.stored };
      return marketRepository.createListing({
        accountId: username,
        vaultId,
        stored: vault.stored,
        slot,
        oldItems: vault.items ? oldItems : null,
        newItems,
        itemBytes,
        item: decoded,
        price,
      });
    });

    if (result.Result !== 0) throw resultError(result.Result);
    const listingId = Number(result.ListingId);

    await auditLog.record({
      accountId: username,
      username,
      eventType: 'market.listing_created',
      ...requestMeta(req),
      details: {
        listingId,
        vaultId,
        stored: created.stored,
        slot,
        price,
        item: `${created.decoded.group}:${created.decoded.index}`,
        serial: created.decoded.serial,
      },
    });

    res.status(201).json({ id: listingId, price, item: created.decoded.name });
  } catch (err) {
    await recordFailure(req, 'market.listing_created', err, { vaultId, slot, price });
    next(err);
  }
}

/**
 * Comprar e retirar seguem o mesmo caminho: achar espaço no baú escolhido,
 * pôr os 16 bytes do anúncio lá e chamar a procedure.
 */
async function placeListingInVault(req, { listing, vaultId, call }) {
  const username = req.user.username;
  const entry = marketItems.catalogEntry(listing.itemGroup, listing.itemIndex);
  const width = entry ? entry.width : listing.width;
  const height = entry ? entry.height : listing.height;

  let placed = null;
  const result = await withRetry(async () => {
    const vault = await loadVault(username, vaultId);
    const oldItems = vaultBuffer(vault);
    const slot = warehouseService.findFreeArea(oldItems, width, height);
    if (slot === -1) {
      throw new AppError(409, 'WAREHOUSE_FULL', `Não há espaço ${width}x${height} livre neste baú. Escolha outro baú ou libere espaço.`);
    }
    const newItems = Buffer.from(oldItems);
    Buffer.from(listing.itemBytes).copy(newItems, slot * ITEM_BYTES);
    placed = { slot, stored: vault.stored };
    return call({
      listingId: Number(listing.id),
      accountId: username,
      vaultId,
      stored: vault.stored,
      slot,
      oldItems: vault.items ? oldItems : null,
      newItems,
    });
  });
  return { result, placed };
}

async function buyListing(req, res, next) {
  const username = req.user.username;
  const listingId = req.params.id;
  const { vaultId } = req.body;
  try {
    const listing = await marketRepository.findListingById(listingId);
    if (!listing || listing.status !== 'active' || listing.expired) throw resultError(5);
    if (listing.sellerAccount === username) throw resultError(8);

    const { result, placed } = await placeListingInVault(req, {
      listing,
      vaultId,
      call: marketRepository.buyListing,
    });
    if (result.Result !== 0) throw resultError(result.Result);

    const item = itemDetails(listing.itemBytes);
    await auditLog.record({
      accountId: username,
      username,
      eventType: 'market.listing_bought',
      ...requestMeta(req),
      details: {
        listingId: Number(listing.id),
        seller: listing.sellerAccount,
        price: result.Price,
        sellerReceived: result.SellerReceived,
        vaultId,
        stored: placed.stored,
        slot: placed.slot,
        item: `${listing.itemGroup}:${listing.itemIndex}`,
      },
    });

    res.json({ id: Number(listing.id), price: result.Price, item: item ? item.name : listing.itemName, vaultId, slot: placed.slot });
  } catch (err) {
    await recordFailure(req, 'market.listing_bought', err, { listingId, vaultId });
    next(err);
  }
}

async function returnListing(req, res, next) {
  const username = req.user.username;
  const listingId = req.params.id;
  const { vaultId } = req.body;
  try {
    const listing = await marketRepository.findListingById(listingId);
    if (!listing || listing.sellerAccount !== username || listing.status !== 'active') throw resultError(5);

    const { result, placed } = await placeListingInVault(req, {
      listing,
      vaultId,
      call: marketRepository.returnListing,
    });
    if (result.Result !== 0) throw resultError(result.Result);

    await auditLog.record({
      accountId: username,
      username,
      eventType: 'market.listing_returned',
      ...requestMeta(req),
      details: {
        listingId: Number(listing.id),
        expired: Boolean(listing.expired),
        vaultId,
        stored: placed.stored,
        slot: placed.slot,
        item: `${listing.itemGroup}:${listing.itemIndex}`,
      },
    });

    res.json({ id: Number(listing.id), vaultId, slot: placed.slot });
  } catch (err) {
    await recordFailure(req, 'market.listing_returned', err, { listingId, vaultId });
    next(err);
  }
}

async function renewListing(req, res, next) {
  const username = req.user.username;
  const listingId = req.params.id;
  try {
    const result = await withRetry(() => marketRepository.renewListing({ listingId, accountId: username }));
    if (result.Result !== 0) {
      throw new AppError(409, 'LISTING_NOT_RENEWABLE', 'Só é possível renovar um anúncio seu que já expirou.');
    }
    await auditLog.record({
      accountId: username,
      username,
      eventType: 'market.listing_renewed',
      ...requestMeta(req),
      details: { listingId },
    });
    const listing = await marketRepository.findListingById(listingId);
    res.json({ id: listingId, expiresAt: listing ? listing.expiresAt : null });
  } catch (err) {
    next(err);
  }
}

/**
 * Falhas que merecem rastro: as inesperadas (500) e as de concorrência
 * (baú mudou, servidor ocupado). Recusas comuns (sem gold, baú cheio,
 * anúncio vendido) não poluem a auditoria.
 */
async function recordFailure(req, eventType, err, details) {
  const status = err && err.statusCode;
  const code = err && err.code;
  if (status && status < 500 && code !== 'VAULT_CHANGED') return;
  if (!status) logger.error({ err, eventType }, 'Falha inesperada no mercado');
  await auditLog.record({
    accountId: req.user.username,
    username: req.user.username,
    eventType,
    success: false,
    ...requestMeta(req),
    details: { ...details, reason: code || (err && err.message) },
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function getRepeatedSerials(req, res, next) {
  try {
    const serials = await marketRepository.findRepeatedSerials();
    res.json({ serials });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  requireMarketAccess,
  getCatalog,
  getVaults,
  searchListings,
  getListing,
  getMyListings,
  getMyPurchases,
  createListing,
  buyListing,
  returnListing,
  renewListing,
  getRepeatedSerials,
};
