const { Router } = require('express');

const requireAuth = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { ticketCreateLimiter } = require('../middlewares/rateLimiters');
const schemas = require('../validators/supportValidators');
const controller = require('../controllers/supportController');

const router = Router();

router.use('/support', requireAuth);

router.post('/support/tickets', ticketCreateLimiter, validate(schemas.createTicket), controller.createTicket);
router.get('/support/tickets', validate(schemas.listQuery, 'query'), controller.listTickets);
router.get('/support/tickets/:id', validate(schemas.idParam, 'params'), controller.getTicket);
router.post(
  '/support/tickets/:id/reply',
  validate(schemas.idParam, 'params'),
  validate(schemas.reply),
  controller.replyTicket,
);
router.post('/support/tickets/:id/close', validate(schemas.idParam, 'params'), controller.closeTicket);

module.exports = router;
