const campaignsRepository = require('../db/campaignsRepository');
const AppError = require('../utils/AppError');

/**
 * POST /campaigns/visit — o front chama ao abrir mupro.vip/bonus/<codigo>.
 * 404 se a campanha não existe (o front então não guarda o código).
 */
async function visit(req, res, next) {
  try {
    const { code, visitorId } = req.body;
    const outcome = await campaignsRepository.recordVisit({
      code,
      visitorId: visitorId.toLowerCase(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if (outcome === 'not_found') {
      throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
    }

    res.json({ recorded: outcome === 'recorded' });
  } catch (err) {
    next(err);
  }
}

module.exports = { visit };
