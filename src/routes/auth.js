const { Router } = require('express');

const validate = require('../middlewares/validate');
const requireAuth = require('../middlewares/auth');
const schemas = require('../validators/authValidators');
const {
  loginIpLimiter,
  loginUsernameLimiter,
  resendConfirmationLimiter,
  forgotPasswordLimiter,
} = require('../middlewares/rateLimiters');
const controller = require('../controllers/authController');

const router = Router();

router.post('/auth/register', validate(schemas.register), controller.register);
router.post('/auth/confirm-email', validate(schemas.confirmEmail), controller.confirmEmail);
router.post(
  '/auth/resend-confirmation',
  resendConfirmationLimiter,
  validate(schemas.resendConfirmation),
  controller.resendConfirmation,
);
router.post(
  '/auth/login',
  loginIpLimiter,
  loginUsernameLimiter,
  validate(schemas.login),
  controller.login,
);
router.post('/auth/refresh-token', validate(schemas.refreshToken), controller.refreshTokenHandler);
router.post('/auth/logout', validate(schemas.refreshToken), controller.logout);
router.post(
  '/auth/forgot-password',
  forgotPasswordLimiter,
  validate(schemas.forgotPassword),
  controller.forgotPassword,
);
router.post('/auth/reset-password', validate(schemas.resetPassword), controller.resetPassword);
router.post(
  '/auth/change-password',
  requireAuth,
  validate(schemas.changePassword),
  controller.changePassword,
);

module.exports = router;
