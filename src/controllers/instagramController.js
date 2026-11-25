const AppError = require('../utils/AppError');
const auditLog = require('../db/auditLogRepository');
const campaign = require('../services/instagramCampaignService');

/** Campanha desligada (e conta fora de INSTAGRAM_TESTERS): 403. */
function requireCampaign(req, res, next) {
  if (campaign.isActiveFor(req.user.username)) return next();
  return next(new AppError(403, 'CAMPAIGN_DISABLED', 'A campanha do Instagram não está ativa no momento.'));
}

async function getStatus(req, res, next) {
  try {
    res.json(await campaign.getStatus(req.user.username));
  } catch (err) {
    next(err);
  }
}

async function createLinkCode(req, res, next) {
  try {
    res.status(201).json(await campaign.createLinkCode(req.user.username));
  } catch (err) {
    next(err);
  }
}

async function unlink(req, res, next) {
  try {
    const removed = await campaign.unlink(req.user.username);
    if (!removed) throw new AppError(404, 'INSTAGRAM_NOT_LINKED', 'Nenhum Instagram vinculado a esta conta.');
    await auditLog.record({
      accountId: req.user.username,
      username: req.user.username,
      eventType: 'instagram.unlink',
      success: true,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { igsid: removed.igsid, igUsername: removed.igUsername },
    });
    res.json({ message: 'Instagram desvinculado.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { requireCampaign, getStatus, createLinkCode, unlink };
