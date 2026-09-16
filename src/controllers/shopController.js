const AppError = require('../utils/AppError');
const creditPackagesRepository = require('../db/creditPackagesRepository');
const shopItemsRepository = require('../db/shopItemsRepository');
const shopBundlesRepository = require('../db/shopBundlesRepository');
const pixChargesRepository = require('../db/pixChargesRepository');
const itemRedemptionsRepository = require('../db/itemRedemptionsRepository');
const bundleRedemptionsRepository = require('../db/bundleRedemptionsRepository');
const shopHistoryRepository = require('../db/shopHistoryRepository');
const accountsRepository = require('../db/accountsRepository');
const charactersRepository = require('../db/charactersRepository');
const auditLog = require('../db/auditLogRepository');
const efiClient = require('../services/efiClient');
const inventoryService = require('../services/inventoryService');
const logger = require('../utils/logger');

function toCatalogEntry(kind, row) {
  if (kind === 'credit') {
    return {
      catalogId: `credit:${row.Id}`,
      kind: 'credit_package',
      name: row.Name,
      priceCents: row.PriceCents,
      creditsAmount: row.CreditsAmount,
    };
  }
  if (kind === 'bundle') {
    return {
      catalogId: `bundle:${row.Id}`,
      kind: 'item_bundle',
      name: row.Name,
      description: row.Description,
      priceCredits: row.PriceCredits,
      items: row.Items.map((component) => ({ name: component.ItemName, quantity: component.ComponentQuantity })),
    };
  }
  return {
    catalogId: `item:${row.Id}`,
    kind: 'game_item',
    name: row.Name,
    description: row.Description,
    priceCredits: row.PriceCredits,
  };
}

function parseCatalogId(catalogId) {
  const [kind, idStr] = String(catalogId).split(':');
  const id = Number(idStr);
  return { kind, id };
}

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

async function getItems(req, res, next) {
  try {
    const [packages, items, bundles] = await Promise.all([
      creditPackagesRepository.findActive(),
      shopItemsRepository.findActive(),
      shopBundlesRepository.findActiveWithItems(),
    ]);
    res.json({
      items: [
        ...packages.map((p) => toCatalogEntry('credit', p)),
        ...items.map((i) => toCatalogEntry('item', i)),
        ...bundles.map((b) => toCatalogEntry('bundle', b)),
      ],
    });
  } catch (err) {
    next(err);
  }
}

async function getItemById(req, res, next) {
  try {
    const { kind, id } = parseCatalogId(req.params.id);

    if (kind === 'credit') {
      const row = await creditPackagesRepository.findById(id);
      if (!row || !row.Active) throw new AppError(404, 'NOT_FOUND', 'Pacote de créditos não encontrado.');
      return res.json(toCatalogEntry('credit', row));
    }

    if (kind === 'bundle') {
      const row = await shopBundlesRepository.findById(id);
      if (!row || !row.Active) throw new AppError(404, 'NOT_FOUND', 'Pacote não encontrado.');
      return res.json(toCatalogEntry('bundle', row));
    }

    const row = await shopItemsRepository.findById(id);
    if (!row || !row.Active) throw new AppError(404, 'NOT_FOUND', 'Item não encontrado.');
    return res.json(toCatalogEntry('item', row));
  } catch (err) {
    return next(err);
  }
}

async function purchaseCreditPackage(req, res, id, username, meta) {
  const pkg = await creditPackagesRepository.findById(id);
  if (!pkg || !pkg.Active) throw new AppError(404, 'NOT_FOUND', 'Pacote de créditos não encontrado.');

  const charge = await efiClient.createImmediateCharge({
    amountCents: pkg.PriceCents,
    description: `Créditos ${pkg.Name} - conta ${username}`,
  });

  await pixChargesRepository.create({
    accountId: username,
    packageId: pkg.Id,
    txid: charge.txid,
    amountCents: pkg.PriceCents,
    creditsAmount: pkg.CreditsAmount,
  });

  await auditLog.record({
    accountId: username,
    username,
    eventType: 'shop.pix_charge_created',
    success: true,
    ...meta,
    details: { txid: charge.txid, packageId: pkg.Id, amountCents: pkg.PriceCents },
  });

  res.status(201).json({
    type: 'pix_charge',
    txid: charge.txid,
    pixCopiaECola: charge.pixCopiaECola,
    qrCodeImage: charge.qrCodeImage,
    amountCents: pkg.PriceCents,
    creditsAmount: pkg.CreditsAmount,
  });
}

async function purchaseItem(req, res, id, username, meta) {
  const { characterName } = req.body;
  if (!characterName) {
    throw new AppError(400, 'VALIDATION_ERROR', 'characterName é obrigatório para resgatar um item.');
  }

  const item = await shopItemsRepository.findById(id);
  if (!item || !item.Active) throw new AppError(404, 'NOT_FOUND', 'Item não encontrado.');

  const character = await charactersRepository.findOwnedCharacter(username, characterName);
  if (!character) throw new AppError(404, 'NOT_FOUND', 'Personagem não encontrado nesta conta.');

  const debited = await accountsRepository.debitCash(username, item.PriceCredits);
  if (!debited) {
    throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Créditos insuficientes.');
  }

  let inventoryResult;
  try {
    const inventoryBuffer = await charactersRepository.getInventoryBuffer(characterName);
    inventoryResult = inventoryService.insertItemIntoInventory(inventoryBuffer, {
      itemGroup: item.ItemGroup,
      itemIndex: item.ItemIndex,
      itemLevel: item.ItemLevel,
      quantity: item.Quantity,
    });
    await charactersRepository.updateInventory(characterName, inventoryResult.buffer);
  } catch (err) {
    // Falhou depois de já ter debitado — devolve os créditos.
    await accountsRepository.creditCash(username, item.PriceCredits);
    await auditLog.record({
      accountId: username,
      username,
      eventType: 'shop.item_redeemed',
      success: false,
      ...meta,
      details: { itemId: item.Id, characterName, reason: err.code || err.message },
    });
    throw err;
  }

  await itemRedemptionsRepository.create({
    accountId: username,
    characterName,
    shopItemId: item.Id,
    priceCredits: item.PriceCredits,
    slot: inventoryResult.slot,
  });

  await auditLog.record({
    accountId: username,
    username,
    eventType: 'shop.item_redeemed',
    success: true,
    ...meta,
    details: { itemId: item.Id, characterName, slot: inventoryResult.slot, priceCredits: item.PriceCredits },
  });

  res.status(201).json({ type: 'item_redeemed', item: item.Name, characterName, slot: inventoryResult.slot });
}

/**
 * Cada componente do pacote vira N itemSpecs (um por instância/slot) —
 * "10x Jewel Pack" ocupa 10 slots, um pra cada unidade, exatamente como
 * comprar o mesmo item avulso 10 vezes.
 */
function expandBundleComponents(bundle) {
  return bundle.Items.flatMap((component) =>
    Array.from({ length: component.ComponentQuantity }, () => ({
      itemGroup: component.ItemGroup,
      itemIndex: component.ItemIndex,
      itemLevel: component.ItemLevel,
      quantity: component.ItemQuantity,
    })),
  );
}

async function purchaseBundle(req, res, id, username, meta) {
  const { characterName } = req.body;
  if (!characterName) {
    throw new AppError(400, 'VALIDATION_ERROR', 'characterName é obrigatório para resgatar um pacote.');
  }

  const bundle = await shopBundlesRepository.findById(id);
  if (!bundle || !bundle.Active) throw new AppError(404, 'NOT_FOUND', 'Pacote não encontrado.');

  const character = await charactersRepository.findOwnedCharacter(username, characterName);
  if (!character) throw new AppError(404, 'NOT_FOUND', 'Personagem não encontrado nesta conta.');

  const debited = await accountsRepository.debitCash(username, bundle.PriceCredits);
  if (!debited) {
    throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Créditos insuficientes.');
  }

  let insertResult;
  try {
    const inventoryBuffer = await charactersRepository.getInventoryBuffer(characterName);
    insertResult = inventoryService.insertItemsIntoInventory(inventoryBuffer, expandBundleComponents(bundle));
    await charactersRepository.updateInventory(characterName, insertResult.buffer);
  } catch (err) {
    // Tudo ou nada: se faltou espaço pra qualquer item do pacote, nada foi
    // gravado no Inventory — só precisa estornar o débito.
    await accountsRepository.creditCash(username, bundle.PriceCredits);
    await auditLog.record({
      accountId: username,
      username,
      eventType: 'shop.bundle_redeemed',
      success: false,
      ...meta,
      details: { bundleId: bundle.Id, characterName, reason: err.code || err.message },
    });
    throw err;
  }

  await bundleRedemptionsRepository.create({
    accountId: username,
    characterName,
    bundleId: bundle.Id,
    priceCredits: bundle.PriceCredits,
  });

  await auditLog.record({
    accountId: username,
    username,
    eventType: 'shop.bundle_redeemed',
    success: true,
    ...meta,
    details: {
      bundleId: bundle.Id,
      characterName,
      priceCredits: bundle.PriceCredits,
      slots: insertResult.slots,
      items: bundle.Items.map((c) => ({ shopItemId: c.ItemId, name: c.ItemName, quantity: c.ComponentQuantity })),
    },
  });

  res.status(201).json({ type: 'bundle_redeemed', bundle: bundle.Name, characterName, slots: insertResult.slots });
}

async function purchase(req, res, next) {
  try {
    const { catalogId } = req.body;
    const { kind, id } = parseCatalogId(catalogId);
    const username = req.user.username;
    const meta = requestMeta(req);

    if (kind === 'credit') {
      await purchaseCreditPackage(req, res, id, username, meta);
    } else if (kind === 'bundle') {
      await purchaseBundle(req, res, id, username, meta);
    } else {
      await purchaseItem(req, res, id, username, meta);
    }
  } catch (err) {
    next(err);
  }
}

async function getCredits(req, res, next) {
  try {
    const account = await accountsRepository.findByUsername(req.user.username);
    res.json({ cash: account?.cash ?? 0 });
  } catch (err) {
    next(err);
  }
}

async function getHistory(req, res, next) {
  try {
    const { page, limit } = req.query;
    const { items, total } = await shopHistoryRepository.findByAccount(req.user.username, { page, limit });
    res.json({ page, limit, total, items });
  } catch (err) {
    next(err);
  }
}

/**
 * Nunca credita com base no payload do webhook sozinho — sempre reconsulta
 * a cobrança direto na API da Efí (autenticado com nosso certificado)
 * antes de creditar qualquer coisa. Idempotente via WebPixCharges.Status.
 */
async function processPixNotification(txid) {
  if (!txid) return;

  const charge = await efiClient.getChargeStatus(txid);
  if (charge.status !== 'CONCLUIDA') {
    logger.info({ txid, status: charge.status }, 'Webhook Pix recebido, cobrança ainda não confirmada como paga');
    return;
  }

  const localCharge = await pixChargesRepository.findByTxId(txid);
  if (!localCharge) {
    logger.warn({ txid }, 'Webhook Pix recebido para txid desconhecido nesta API');
    return;
  }

  const wasNewlyPaid = await pixChargesRepository.markPaid(txid);
  if (!wasNewlyPaid) {
    return; // já processado antes (idempotência)
  }

  await accountsRepository.creditCash(localCharge.AccountId, localCharge.CreditsAmount);
  await auditLog.record({
    accountId: localCharge.AccountId,
    username: localCharge.AccountId,
    eventType: 'shop.pix_payment_confirmed',
    success: true,
    details: { txid, creditsAmount: localCharge.CreditsAmount },
  });
}

async function paymentWebhook(req, res, next) {
  try {
    const notifications = req.body?.pix || [];
    for (const notification of notifications) {
      // eslint-disable-next-line no-await-in-loop
      await processPixNotification(notification.txid);
    }
    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { getItems, getItemById, purchase, getCredits, getHistory, paymentWebhook };
