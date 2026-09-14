/**
 * Erro de aplicação com formato padronizado.
 * Middlewares e rotas devem lançar isso (em vez de Error genérico)
 * sempre que o erro tiver um código/status HTTP conhecido.
 */
class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

module.exports = AppError;
