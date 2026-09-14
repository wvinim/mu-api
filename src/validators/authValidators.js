const Joi = require('joi');

// memb___id é varchar(10) na tabela de contas — username não pode passar disso.
const username = Joi.string()
  .pattern(/^[a-zA-Z0-9_]{4,10}$/)
  .messages({ 'string.pattern.base': 'Username deve ter 4-10 caracteres alfanuméricos ou "_".' });

// memb__pwd é varchar(10) — a mesma senha é usada no client do jogo e no
// site (estratégia híbrida), então o limite de 10 vale para as duas.
const password = Joi.string().min(6).max(10).messages({
  'string.max': 'Senha deve ter no máximo 10 caracteres (limite do client do jogo).',
  'string.min': 'Senha deve ter ao menos 6 caracteres.',
});

const email = Joi.string().email().max(50);

const register = Joi.object({
  username: username.required(),
  password: password.required(),
  email: email.required(),
});

const confirmEmail = Joi.object({
  token: Joi.string().required(),
});

const resendConfirmation = Joi.object({
  email: email.required(),
});

const login = Joi.object({
  username: Joi.string().max(10).required(),
  password: Joi.string().max(10).required(),
});

const refreshToken = Joi.object({
  refreshToken: Joi.string().required(),
});

const forgotPassword = Joi.object({
  email: email.required(),
});

const resetPassword = Joi.object({
  token: Joi.string().required(),
  password: password.required(),
});

const changePassword = Joi.object({
  currentPassword: Joi.string().max(10).required(),
  newPassword: password.required(),
});

module.exports = {
  register,
  confirmEmail,
  resendConfirmation,
  login,
  refreshToken,
  forgotPassword,
  resetPassword,
  changePassword,
};
