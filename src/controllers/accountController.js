const AppError = require('../utils/AppError');
const accountsRepository = require('../db/accountsRepository');
const charactersRepository = require('../db/charactersRepository');
const autopickRepository = require('../db/autopickRepository');
const auditLog = require('../db/auditLogRepository');
const { getRole } = require('../services/roleService');
const vipAutopickCatalog = require('../services/vipAutopickCatalog');

const MEGA_VIP_TIER = 3;

async function getMe(req, res, next) {
  try {
    const account = await accountsRepository.findByUsername(req.user.username);
    if (!account) throw new AppError(404, 'NOT_FOUND', 'Conta não encontrada.');

    res.json({
      username: account.username,
      displayName: account.displayName,
      email: account.email,
      role: getRole(account.username),
      emailConfirmed: account.emailConfirmed,
      cash: account.cash,
      vip: account.vip,
      vipStartDate: account.vipStartDate,
      vipEndDate: account.vipEndDate,
      createdAt: account.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

async function updateMe(req, res, next) {
  try {
    const { displayName } = req.body;
    await accountsRepository.updateProfile(req.user.username, { displayName });
    await auditLog.record({
      accountId: req.user.username,
      username: req.user.username,
      eventType: 'account.update_profile',
      success: true,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.json({ message: 'Perfil atualizado com sucesso.' });
  } catch (err) {
    next(err);
  }
}

async function getCharacters(req, res, next) {
  try {
    const characters = await charactersRepository.findByAccountId(req.user.username);
    res.json({ characters });
  } catch (err) {
    next(err);
  }
}

async function getSecurityLog(req, res, next) {
  try {
    const { page, limit } = req.query;
    const { items, total } = await auditLog.findByAccount(req.user.username, { page, limit });
    res.json({ page, limit, total, items });
  } catch (err) {
    next(err);
  }
}

/**
 * Retorna a seleção salva independente da tier atual (decisão do
 * usuário: downgrade/expiração do Mega Vip não limpa a seleção — quem
 * decide se usa é o gameserver, olhando a tier no momento). Ver
 * docs/SECTION_9_VIP.md.
 */
async function getAutopick(req, res, next) {
  try {
    const items = await autopickRepository.findByAccount(req.user.username);
    res.json({
      items: items.map((row) => {
        const option = vipAutopickCatalog.findOption(row.ItemGroup, row.ItemIndex, row.ItemLevel);
        return { itemGroup: row.ItemGroup, itemIndex: row.ItemIndex, itemLevel: row.ItemLevel, name: option?.name ?? null };
      }),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Só permitido pra quem é Mega Vip NESTE momento (checa Vip=3 na hora da
 * chamada, não guarda estado de "já foi Mega Vip alguma vez"). Substitui
 * a seleção inteira — mesmo padrão de PATCH /admin/shop/bundles/:id com
 * `items`.
 *
 * Bloqueia gravação enquanto a conta está logada no jogo (mesma razão do
 * CHARACTER_ONLINE na loja — o gameserver pode ter/gravar por cima um
 * estado de MEMB_AUTOPICK_ITEMS já carregado em memória).
 */
async function updateAutopick(req, res, next) {
  try {
    const account = await accountsRepository.findByUsername(req.user.username);
    if (!account || account.vip !== MEGA_VIP_TIER) {
      throw new AppError(403, 'MEGA_VIP_REQUIRED', 'Seleção de autopick disponível somente para contas Mega Vip.');
    }

    const online = await accountsRepository.isAccountOnline(req.user.username);
    if (online) {
      throw new AppError(409, 'CHARACTER_ONLINE', 'Saia do jogo antes de alterar a seleção de autopick.');
    }

    const { items } = req.body;
    for (const item of items) {
      if (!vipAutopickCatalog.isAllowedAutopickItem(item.itemGroup, item.itemIndex, item.itemLevel)) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `Item grupo=${item.itemGroup} índice=${item.itemIndex} level=${item.itemLevel} não está na lista de autopick permitida.`,
        );
      }
    }

    await autopickRepository.replaceAll(req.user.username, items);
    await auditLog.record({
      accountId: req.user.username,
      username: req.user.username,
      eventType: 'account.autopick_updated',
      success: true,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { items },
    });

    res.json({ message: 'Seleção de autopick atualizada.', items });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe, updateMe, getCharacters, getSecurityLog, getAutopick, updateAutopick };
