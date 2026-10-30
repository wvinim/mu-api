const { getPool, sql } = require('./pool');

/**
 * Acesso à tabela MEMB_INFO — a mesma tabela usada pelo login do client do
 * jogo. Só usamos aqui as colunas já existentes (nenhuma alteração de
 * schema) mais WebPasswordHash, que já existe na tabela.
 *
 * Convenções confirmadas com o usuário (ver docs/SECTION_2_AUTH.md):
 *   - bloc_code: '0' = ativa, '1' = banida
 *   - mail_chek: '0' = e-mail pendente de confirmação, '1' = confirmado
 *   - ctl1_code: sempre '0' (não representa papel/role neste core)
 */

const ACCOUNT_COLUMNS = `
  memb___id       AS username,
  memb_name       AS displayName,
  mail_addr       AS email,
  mail_chek       AS emailConfirmedFlag,
  bloc_code       AS banFlag,
  ctl1_code       AS ctl1Code,
  Cash            AS cash,
  Vip             AS vip,
  VipStartDate    AS vipStartDate,
  VipEndDate      AS vipEndDate,
  WebPasswordHash AS webPasswordHash,
  appl_days       AS createdAt,
  modi_days       AS modifiedAt
`;

function mapAccountRow(row) {
  if (!row) return null;
  return {
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    emailConfirmed: row.emailConfirmedFlag === '1',
    banned: row.banFlag === '1',
    cash: row.cash,
    vip: row.vip,
    vipStartDate: row.vipStartDate,
    vipEndDate: row.vipEndDate,
    webPasswordHash: row.webPasswordHash,
    createdAt: row.createdAt,
    modifiedAt: row.modifiedAt,
  };
}

async function findByUsername(username) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .query(`SELECT ${ACCOUNT_COLUMNS} FROM MEMB_INFO WHERE memb___id = @username`);
  return mapAccountRow(result.recordset[0]);
}

async function findAllByEmail(email) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('email', sql.VarChar(50), email)
    .query(`SELECT ${ACCOUNT_COLUMNS} FROM MEMB_INFO WHERE mail_addr = @email`);
  return result.recordset.map(mapAccountRow);
}

/**
 * Cria a conta gravando a senha em texto puro (usada pelo client do jogo)
 * e o hash bcrypt (usado exclusivamente pelo login do site), conforme a
 * estratégia híbrida definida no CLAUDE.md. memb_name não tem campo
 * próprio no formulário de registro (fora do escopo numerado) — decisão:
 * espelha o username.
 *
 * E-mail único por conta: mail_addr não tem índice único (e não dá para
 * criar um com segurança — contas legadas com e-mail vazio/duplicado, e um
 * índice filtrado exigiria SET options específicas em toda escrita do
 * gameserver na tabela). A unicidade é garantida aqui: um applock por
 * e-mail serializa registros concorrentes do mesmo endereço, e a checagem
 * + INSERT rodam na mesma transação. O lock é só entre requisições da API
 * — não bloqueia nada do gameserver.
 * Retorna { created: false } se o e-mail já estiver em uso.
 */
async function createAccount({ username, plainPassword, email, passwordHash }) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .input('plainPassword', sql.VarChar(10), plainPassword)
    .input('displayName', sql.VarChar(10), username)
    .input('email', sql.VarChar(50), email)
    .input('passwordHash', sql.VarChar(255), passwordHash)
    .input('lockResource', sql.NVarChar(255), `mu-api:register-email:${email.toLowerCase()}`)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

      DECLARE @lockResult INT;
      EXEC @lockResult = sp_getapplock
        @Resource = @lockResource, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 5000;
      IF @lockResult < 0
      BEGIN
        -- RAISERROR, não THROW: o banco do MU pode estar com compatibility
        -- level < 110, onde THROW não existe (ver pixChargesRepository).
        ROLLBACK TRANSACTION;
        RAISERROR('Timeout ao obter lock de registro por e-mail', 16, 1);
        RETURN;
      END

      IF EXISTS (SELECT 1 FROM MEMB_INFO WHERE mail_addr = @email)
      BEGIN
        COMMIT TRANSACTION;
        SELECT CAST(0 AS BIT) AS created;
      END
      ELSE
      BEGIN
        INSERT INTO MEMB_INFO
          (memb___id, memb__pwd, memb_name, mail_addr, appl_days, mail_chek, bloc_code, ctl1_code, Cash, Vip, WebPasswordHash)
        VALUES
          (@username, @plainPassword, @displayName, @email, GETDATE(), '0', '0', '0', 0, 0, @passwordHash);
        COMMIT TRANSACTION;
        SELECT CAST(1 AS BIT) AS created;
      END
    `);
  return { created: Boolean(result.recordset[0].created) };
}

/**
 * Marca o e-mail como confirmado e, se `bonus` vier, concede o bônus de
 * boas-vindas no MESMO UPDATE. O filtro `mail_chek <> '1'` garante que só a
 * transição pendente→confirmado aplica o bônus: duas requisições
 * concorrentes com o mesmo token (ou uma conta já confirmada) não creditam
 * duas vezes. O VIP é gravado do zero (sem somar dias) porque a conta
 * ainda não podia logar nem comprar nada antes de confirmar o e-mail.
 * Retorna { confirmed: false } quando a conta já estava confirmada.
 */
async function setEmailConfirmed(username, bonus = null) {
  const pool = getPool();
  const request = pool.request().input('username', sql.VarChar(10), username);

  const sets = ["mail_chek = '1'", 'modi_days = GETDATE()'];
  if (bonus && bonus.cash > 0) {
    request.input('bonusCash', sql.Int, bonus.cash);
    sets.push('Cash = ISNULL(Cash, 0) + @bonusCash');
  }
  if (bonus && bonus.vipTier > 0) {
    request.input('bonusVipTier', sql.Int, bonus.vipTier).input('bonusVipDays', sql.Int, bonus.vipDays);
    sets.push('Vip = @bonusVipTier', 'VipStartDate = GETDATE()', 'VipEndDate = DATEADD(day, @bonusVipDays, GETDATE())');
  }

  const result = await request.query(`
    UPDATE MEMB_INFO
    SET ${sets.join(', ')}
    OUTPUT INSERTED.Cash AS cash, INSERTED.Vip AS vip, INSERTED.VipEndDate AS vipEndDate
    WHERE memb___id = @username AND (mail_chek IS NULL OR mail_chek <> '1')
  `);
  const row = result.recordset[0];
  return row ? { confirmed: true, ...row } : { confirmed: false };
}

/**
 * Atualiza as duas colunas de senha ao mesmo tempo (jogo + site), para
 * nunca ficarem dessincronizadas.
 */
async function updatePasswordBoth(username, { plainPassword, passwordHash }) {
  const pool = getPool();
  await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .input('plainPassword', sql.VarChar(10), plainPassword)
    .input('passwordHash', sql.VarChar(255), passwordHash)
    .query(`
      UPDATE MEMB_INFO
      SET memb__pwd = @plainPassword, WebPasswordHash = @passwordHash, modi_days = GETDATE()
      WHERE memb___id = @username
    `);
}

/**
 * Só atualiza memb_name (display name). Os demais campos "de perfil" que
 * existem na tabela (post_code, addr_info, addr_deta, tel__numb,
 * phon_numb) são campos legados de webzine coreano (endereço/telefone) —
 * decisão: deixados de fora por ora, já que não têm uso claro neste
 * projeto. Fácil de expor depois se for necessário.
 */
async function updateProfile(username, { displayName }) {
  const pool = getPool();
  await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .input('displayName', sql.VarChar(10), displayName)
    .query("UPDATE MEMB_INFO SET memb_name = @displayName, modi_days = GETDATE() WHERE memb___id = @username");
}

/**
 * Usado para bloquear resgates da loja enquanto o jogador está logado no
 * jogo (só existe um personagem ativo por conta por vez, então "conta
 * online" já identifica o personagem online). Ver docs/SECTION_8_SERVER.md
 * sobre a confiabilidade de MEMB_STAT.ConnectStat.
 */
async function isAccountOnline(username) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .query('SELECT 1 AS online FROM MEMB_STAT WHERE memb___id = @username AND ConnectStat = 1');
  return result.recordset.length > 0;
}

/**
 * Renova/estende o VIP: soma `days` dias em cima do que sobrar da
 * validade atual (nunca em cima de uma data já vencida no passado — se o
 * VIP estava expirado ou nunca existiu, conta a partir de agora). A tier
 * é sempre atualizada pra `tier`.
 *
 * Regra de negócio (decisão do usuário, 2026-09-17): comprar uma tier
 * MAIOR que a ativa no momento é upgrade — descarta os dias restantes do
 * plano antigo e conta só os dias do novo plano a partir de agora (não
 * soma). Comprar a MESMA tier (renovação) ou uma tier MENOR (downgrade)
 * continua somando `days` ao período restante, mantendo a data de início
 * original — mesmo comportamento de antes. `VipEndDate` na comparação
 * `@tier > Vip` sempre lê o valor da linha ANTES deste UPDATE (garantia
 * do SQL Server pra expressões no SET), então a comparação é sempre
 * contra a tier antiga, mesmo sendo a mesma coluna que está sendo escrita.
 * Retorna o estado atualizado de Vip/VipStartDate/VipEndDate.
 */
async function renewVip(username, { tier, days }) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .input('tier', sql.Int, tier)
    .input('days', sql.Int, days)
    .query(`
      UPDATE MEMB_INFO
      SET
        Vip = @tier,
        VipStartDate = CASE
          WHEN VipEndDate IS NOT NULL AND VipEndDate > GETDATE() AND @tier > Vip THEN GETDATE()
          WHEN VipEndDate IS NOT NULL AND VipEndDate > GETDATE() THEN VipStartDate
          ELSE GETDATE()
        END,
        VipEndDate = CASE
          WHEN VipEndDate IS NOT NULL AND VipEndDate > GETDATE() AND @tier > Vip THEN DATEADD(day, @days, GETDATE())
          WHEN VipEndDate IS NOT NULL AND VipEndDate > GETDATE() THEN DATEADD(day, @days, VipEndDate)
          ELSE DATEADD(day, @days, GETDATE())
        END,
        modi_days = GETDATE()
      OUTPUT INSERTED.Vip AS vip, INSERTED.VipStartDate AS vipStartDate, INSERTED.VipEndDate AS vipEndDate
      WHERE memb___id = @username
    `);
  return result.recordset[0] || null;
}

/** Revogação imediata (admin) — zera a tier e expira a validade agora. Não mexe em VipStartDate (histórico). */
async function revokeVip(username) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .query(`
      UPDATE MEMB_INFO
      SET Vip = 0, VipEndDate = GETDATE(), modi_days = GETDATE()
      OUTPUT INSERTED.Vip AS vip, INSERTED.VipStartDate AS vipStartDate, INSERTED.VipEndDate AS vipEndDate
      WHERE memb___id = @username
    `);
  return result.recordset[0] || null;
}

/** Crédito incondicional (ex: confirmação de pagamento Pix). */
async function creditCash(username, amount) {
  const pool = getPool();
  await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .input('amount', sql.Int, amount)
    .query('UPDATE MEMB_INFO SET Cash = Cash + @amount, modi_days = GETDATE() WHERE memb___id = @username');
}

/**
 * Débito atômico: a condição `Cash >= @amount` faz parte do mesmo UPDATE,
 * então duas requisições concorrentes de resgate não conseguem "gastar" o
 * mesmo saldo duas vezes (SQL Server bloqueia a linha durante o update).
 * Retorna false quando o saldo era insuficiente (nada foi alterado).
 */
async function debitCash(username, amount) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .input('amount', sql.Int, amount)
    .query(`
      UPDATE MEMB_INFO
      SET Cash = Cash - @amount, modi_days = GETDATE()
      WHERE memb___id = @username AND Cash >= @amount
    `);
  return result.rowsAffected[0] > 0;
}

/** Listagem paginada para o painel de administração. */
const ADMIN_LIST_HIDDEN_EMAIL = 'wvinim+2@gmail.com';

async function findAllPaginated({ page = 1, limit = 20, search, banned } = {}) {
  const pool = getPool();
  const firstRow = (page - 1) * limit + 1;
  const lastRow = page * limit;
  const request = pool.request().input('firstRow', sql.Int, firstRow).input('lastRow', sql.Int, lastRow);

  // Contas escondidas da listagem do admin. `IS NULL OR` porque `<>` contra
  // NULL descartaria as contas sem e-mail.
  request.input('hiddenEmail', sql.VarChar(50), ADMIN_LIST_HIDDEN_EMAIL);
  const filters = ['(mail_addr IS NULL OR mail_addr <> @hiddenEmail)'];
  if (search) {
    request.input('search', sql.VarChar(50), `%${search}%`);
    filters.push('(memb___id LIKE @search OR mail_addr LIKE @search)');
  }
  if (banned !== undefined) {
    request.input('banFlag', sql.Char(1), banned ? '1' : '0');
    filters.push('bloc_code = @banFlag');
  }
  const whereClause = `WHERE ${filters.join(' AND ')}`;

  const result = await request.query(`
    WITH Ranked AS (
      SELECT
        memb___id AS username, memb_name AS displayName, mail_addr AS email,
        mail_chek AS emailConfirmedFlag, bloc_code AS banFlag, Cash AS cash, Vip AS vip,
        appl_days AS createdAt,
        ROW_NUMBER() OVER (ORDER BY appl_days DESC) AS rank
      FROM MEMB_INFO
      ${whereClause}
    )
    SELECT
      username, displayName, email,
      CASE WHEN emailConfirmedFlag = '1' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS emailConfirmed,
      CASE WHEN banFlag = '1' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS banned,
      cash, vip, createdAt
    FROM Ranked WHERE rank BETWEEN @firstRow AND @lastRow ORDER BY rank;

    -- COUNT(memb___id), não COUNT(*): COUNT(*) exige SELECT em todas as colunas e
    -- o login mu_api tem DENY SELECT em memb__pwd (migration 0009).
    SELECT COUNT(memb___id) AS total FROM MEMB_INFO ${whereClause};
  `);

  return { items: result.recordsets[0], total: result.recordsets[1][0].total };
}

async function setBanned(username, banned) {
  const pool = getPool();
  await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .input('banFlag', sql.Char(1), banned ? '1' : '0')
    .query("UPDATE MEMB_INFO SET bloc_code = @banFlag, modi_days = GETDATE() WHERE memb___id = @username");
}

module.exports = {
  findByUsername,
  findAllByEmail,
  createAccount,
  setEmailConfirmed,
  updatePasswordBoth,
  updateProfile,
  isAccountOnline,
  renewVip,
  revokeVip,
  creditCash,
  debitCash,
  findAllPaginated,
  setBanned,
};
