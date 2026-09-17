const AppError = require('../utils/AppError');
const accountsRepository = require('../db/accountsRepository');
const auditLogRepository = require('../db/auditLogRepository');
const shopItemsRepository = require('../db/shopItemsRepository');
const shopBundlesRepository = require('../db/shopBundlesRepository');
const creditPackagesRepository = require('../db/creditPackagesRepository');
const vipPlansRepository = require('../db/vipPlansRepository');
const tokenService = require('../services/tokenService');
const { getRole } = require('../services/roleService');

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

function logAdminAction(req, eventType, details) {
  return auditLogRepository.record({
    accountId: req.user.username,
    username: req.user.username,
    eventType,
    success: true,
    ...requestMeta(req),
    details,
  });
}

async function listAccounts(req, res, next) {
  try {
    const { page, limit, search, banned } = req.query;
    const result = await accountsRepository.findAllPaginated({ page, limit, search, banned });
    // Não existe id numérico em MEMB_INFO — username (memb___id) é a chave
    // real e é o mesmo valor que /admin/accounts/:id/ban espera. Expomos
    // como `id` também pra não obrigar o front a saber disso, e computamos
    // `role` (não é uma coluna, é derivado das listas fixas do .env).
    const items = result.items.map((item) => ({ id: item.username, ...item, role: getRole(item.username) }));
    res.json({ page, limit, total: result.total, items });
  } catch (err) {
    next(err);
  }
}

async function banAccount(req, res, next) {
  try {
    const { id: username } = req.params;
    const account = await accountsRepository.findByUsername(username);
    if (!account) throw new AppError(404, 'NOT_FOUND', 'Conta não encontrada.');

    await accountsRepository.setBanned(username, true);
    await tokenService.revokeAllRefreshTokensForAccount(username);
    await logAdminAction(req, 'admin.account_ban', { targetAccount: username });

    res.json({ message: `Conta ${username} banida.` });
  } catch (err) {
    next(err);
  }
}

async function unbanAccount(req, res, next) {
  try {
    const { id: username } = req.params;
    const account = await accountsRepository.findByUsername(username);
    if (!account) throw new AppError(404, 'NOT_FOUND', 'Conta não encontrada.');

    await accountsRepository.setBanned(username, false);
    await logAdminAction(req, 'admin.account_unban', { targetAccount: username });

    res.json({ message: `Conta ${username} desbanida.` });
  } catch (err) {
    next(err);
  }
}

/**
 * Concede/estende VIP manualmente (compensação de suporte, sem passar
 * pela compra) ou revoga (tier: 0). Mesma regra de soma de dias da
 * compra normal (accountsRepository.renewVip) — ver docs/SECTION_9_VIP.md.
 */
async function setAccountVip(req, res, next) {
  try {
    const { id: username } = req.params;
    const { tier, days } = req.body;

    const account = await accountsRepository.findByUsername(username);
    if (!account) throw new AppError(404, 'NOT_FOUND', 'Conta não encontrada.');

    const updated =
      tier === 0
        ? await accountsRepository.revokeVip(username)
        : await accountsRepository.renewVip(username, { tier, days });

    await logAdminAction(req, 'admin.account_vip_changed', { targetAccount: username, tier, days });

    res.json({
      message: `VIP da conta ${username} atualizado.`,
      vip: updated.vip,
      vipStartDate: updated.vipStartDate,
      vipEndDate: updated.vipEndDate,
    });
  } catch (err) {
    next(err);
  }
}

async function listVipPlans(req, res, next) {
  try {
    const items = await vipPlansRepository.findAllAdmin();
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

async function updateVipPlan(req, res, next) {
  try {
    const { id } = req.params;
    await vipPlansRepository.update(id, req.body);
    await logAdminAction(req, 'admin.vip_plan_updated', { id, ...req.body });
    res.json({ message: 'Plano VIP atualizado.' });
  } catch (err) {
    next(err);
  }
}

async function listLogs(req, res, next) {
  try {
    const { page, limit, accountId, eventType } = req.query;
    const result = await auditLogRepository.findAll({ page, limit, accountId, eventType });
    res.json({ page, limit, total: result.total, items: result.items });
  } catch (err) {
    next(err);
  }
}

async function listShopItems(req, res, next) {
  try {
    const items = await shopItemsRepository.findAllAdmin();
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

async function createShopItem(req, res, next) {
  try {
    const id = await shopItemsRepository.create(req.body);
    await logAdminAction(req, 'admin.shop_item_created', { id, ...req.body });
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
}

async function updateShopItem(req, res, next) {
  try {
    const { id } = req.params;
    await shopItemsRepository.update(id, req.body);
    await logAdminAction(req, 'admin.shop_item_updated', { id, ...req.body });
    res.json({ message: 'Item atualizado.' });
  } catch (err) {
    next(err);
  }
}

async function deactivateShopItem(req, res, next) {
  try {
    const { id } = req.params;
    await shopItemsRepository.setActive(id, false);
    await logAdminAction(req, 'admin.shop_item_deactivated', { id });
    res.json({ message: 'Item desativado.' });
  } catch (err) {
    next(err);
  }
}

async function listShopBundles(req, res, next) {
  try {
    const items = await shopBundlesRepository.findAllAdmin();
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

async function createShopBundle(req, res, next) {
  try {
    const id = await shopBundlesRepository.create(req.body);
    await logAdminAction(req, 'admin.shop_bundle_created', { id, ...req.body });
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
}

async function updateShopBundle(req, res, next) {
  try {
    const { id } = req.params;
    await shopBundlesRepository.update(id, req.body);
    await logAdminAction(req, 'admin.shop_bundle_updated', { id, ...req.body });
    res.json({ message: 'Pacote de itens atualizado.' });
  } catch (err) {
    next(err);
  }
}

async function deactivateShopBundle(req, res, next) {
  try {
    const { id } = req.params;
    await shopBundlesRepository.setActive(id, false);
    await logAdminAction(req, 'admin.shop_bundle_deactivated', { id });
    res.json({ message: 'Pacote de itens desativado.' });
  } catch (err) {
    next(err);
  }
}

async function listCreditPackages(req, res, next) {
  try {
    const items = await creditPackagesRepository.findAllAdmin();
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

async function createCreditPackage(req, res, next) {
  try {
    const id = await creditPackagesRepository.create(req.body);
    await logAdminAction(req, 'admin.credit_package_created', { id, ...req.body });
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
}

async function updateCreditPackage(req, res, next) {
  try {
    const { id } = req.params;
    await creditPackagesRepository.update(id, req.body);
    await logAdminAction(req, 'admin.credit_package_updated', { id, ...req.body });
    res.json({ message: 'Pacote atualizado.' });
  } catch (err) {
    next(err);
  }
}

async function deactivateCreditPackage(req, res, next) {
  try {
    const { id } = req.params;
    await creditPackagesRepository.setActive(id, false);
    await logAdminAction(req, 'admin.credit_package_deactivated', { id });
    res.json({ message: 'Pacote desativado.' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listAccounts,
  banAccount,
  unbanAccount,
  setAccountVip,
  listVipPlans,
  updateVipPlan,
  listLogs,
  listShopItems,
  createShopItem,
  updateShopItem,
  deactivateShopItem,
  listShopBundles,
  createShopBundle,
  updateShopBundle,
  deactivateShopBundle,
  listCreditPackages,
  createCreditPackage,
  updateCreditPackage,
  deactivateCreditPackage,
};
