const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function optional(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
}

function int(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Variável de ambiente ${name} precisa ser um inteiro válido`);
  }
  return parsed;
}

const nodeEnv = optional('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

const env = {
  nodeEnv,
  isProduction,
  port: int('PORT', 3000),
  // Nº de proxies reversos confiáveis na frente da API (nginx = 1). Sem isso,
  // atrás do nginx req.ip é sempre 127.0.0.1: rate limits por IP viram
  // globais e a auditoria perde o IP real. Deixe 0 se a API for acessada
  // direto — confiar em X-Forwarded-For sem proxy permite forjar o IP.
  trustProxy: int('TRUST_PROXY', 0),

  db: {
    host: isProduction ? required('DB_HOST') : optional('DB_HOST', 'localhost'),
    port: int('DB_PORT', 1433),
    database: isProduction ? required('DB_NAME') : optional('DB_NAME', 'MuOnline'),
    user: isProduction ? required('DB_USER') : optional('DB_USER', ''),
    password: isProduction ? required('DB_PASSWORD') : optional('DB_PASSWORD', ''),
    encrypt: bool('DB_ENCRYPT', true),
    trustServerCertificate: bool('DB_TRUST_SERVER_CERTIFICATE', true),
  },

  jwt: {
    accessSecret: isProduction ? required('JWT_ACCESS_SECRET') : optional('JWT_ACCESS_SECRET', 'dev-access-secret'),
    accessExpiresIn: optional('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshSecret: isProduction ? required('JWT_REFRESH_SECRET') : optional('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
    refreshExpiresIn: optional('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  smtp: {
    host: optional('SMTP_HOST', ''),
    port: int('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: optional('SMTP_USER', ''),
    password: optional('SMTP_PASSWORD', ''),
    from: optional('SMTP_FROM', ''),
    // Assinatura DKIM feita pela própria API (o SMTP da Umbler não assina).
    // Só é aplicada com as três variáveis preenchidas — ver docs/EMAIL_DKIM.md.
    dkim: {
      domainName: optional('DKIM_DOMAIN', ''),
      keySelector: optional('DKIM_SELECTOR', ''),
      privateKeyPath: optional('DKIM_PRIVATE_KEY_PATH', ''),
    },
  },

  efi: {
    clientId: optional('EFI_CLIENT_ID', ''),
    clientSecret: optional('EFI_CLIENT_SECRET', ''),
    sandbox: bool('EFI_SANDBOX', true),
    certificatePath: optional('EFI_CERTIFICATE_PATH', ''),
    webhookSecret: optional('EFI_WEBHOOK_SECRET', ''),
    // Chave Pix cadastrada na conta Efí que vai receber os pagamentos.
    pixKey: optional('EFI_PIX_KEY', ''),
    chargeExpirationSeconds: int('EFI_CHARGE_EXPIRATION_SECONDS', 3600),
  },

  cors: {
    // TODO: perguntar ao usuário o domínio de produção antes de travar o CORS final.
    // Em dev, liberamos localhost livremente (ver src/app.js).
    allowedOrigins: optional('CORS_ALLOWED_ORIGINS', 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },

  rateLimit: {
    loginMax: int('RATE_LIMIT_LOGIN_MAX', 5),
    loginWindowMinutes: int('RATE_LIMIT_LOGIN_WINDOW_MINUTES', 15),
    forgotPasswordMax: int('RATE_LIMIT_FORGOT_PASSWORD_MAX', 3),
    forgotPasswordWindowMinutes: int('RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MINUTES', 60),
    resendConfirmationMax: int('RATE_LIMIT_RESEND_CONFIRMATION_MAX', 3),
    resendConfirmationWindowMinutes: int('RATE_LIMIT_RESEND_CONFIRMATION_WINDOW_MINUTES', 60),
    purchaseMax: int('RATE_LIMIT_PURCHASE_MAX', 1),
    purchaseWindowSeconds: int('RATE_LIMIT_PURCHASE_WINDOW_SECONDS', 3),
    ticketCreateMax: int('RATE_LIMIT_TICKET_CREATE_MAX', 5),
    ticketCreateWindowMinutes: int('RATE_LIMIT_TICKET_CREATE_WINDOW_MINUTES', 60),
  },

  // App/site URL usada para montar os links de confirm-email e reset-password
  // nos e-mails enviados (ex: https://seudominio.com/confirmar-email?token=...).
  appUrl: optional('APP_URL', 'http://localhost:5173'),

  emailTokenTtlHours: int('EMAIL_CONFIRM_TOKEN_TTL_HOURS', 24),
  passwordResetTokenTtlHours: int('PASSWORD_RESET_TOKEN_TTL_HOURS', 1),

  // Cache em memória do ranking de personagens — aceitável para instância
  // única (mesma lógica do rate limit). TTL curto porque o dado muda
  // pouco, mas ranking em tempo real não é um requisito.
  rankingCacheTtlSeconds: int('RANKING_CACHE_TTL_SECONDS', 180),

  // Status do servidor (Seção 8) — cache curto porque o dado muda pouco
  // e a query roda a cada request sem cache. Metadados de /server/info
  // são estáticos (não vêm do banco) — preencha à vontade, todos opcionais.
  server: {
    statusCacheTtlSeconds: int('SERVER_STATUS_CACHE_TTL_SECONDS', 15),
    name: optional('SERVER_NAME', ''),
    season: optional('SERVER_SEASON', 'Season 2.5'),
    expRate: optional('SERVER_EXP_RATE', ''),
    dropRate: optional('SERVER_DROP_RATE', ''),
    maxResets: optional('SERVER_MAX_RESETS', ''),
  },

  // Papel (role) via lista fixa no .env — decisão tomada com o usuário
  // porque ctl1_code não é usado para isso neste core (fica sempre 0).
  roles: {
    adminUsernames: optional('ADMIN_USERNAMES', '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean),
    staffUsernames: optional('STAFF_USERNAMES', '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean),
  },
};

module.exports = env;
