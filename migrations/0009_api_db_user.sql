-- Migration 0009 — login/usuário dedicado da API com privilégio mínimo.
-- NÃO aplicada automaticamente. Rodar no SSMS conectado como `sa` (ou outro
-- sysadmin) no SQL Server da VPS. Ver docs/DB_API_USER.md.
--
-- Não altera nenhuma tabela nem coluna: só cria um login, um usuário no
-- banco MuOnline e dá GRANTs. O gameserver continua usando o login dele.
--
-- Levantamento (2026-09-28, grep em src/db/*.js) do que a API faz em cada
-- tabela. Se um repositório novo passar a tocar outra tabela/coluna, este
-- script precisa de um GRANT correspondente, senão a rota quebra com
-- "The SELECT/INSERT/UPDATE permission was denied".
--
--   Tabela                 SELECT INSERT UPDATE           DELETE
--   MEMB_INFO              sim*   sim    só colunas abaixo  -
--   MEMB_STAT              sim    -      -                  -
--   Character              sim    -      -                  -
--   warehouse              sim    sim    só Items           -
--   MEMB_AUTOPICK_ITEMS    sim    sim    -                  sim
--   WebAuditLog            sim    sim    -                  -   (append-only)
--   WebItemRedemptions     sim    sim    -                  -
--   WebBundleRedemptions   sim    sim    -                  -
--   WebVipPurchases        sim    sim    -                  -
--   WebSupportReplies      sim    sim    -                  -
--   WebShopBundleItems     sim    sim    -                  sim
--   demais Web*            sim    sim    sim                -
--   (* exceto memb__pwd — ver DENY no fim)
--
-- Sem db_owner, sem db_datareader/db_datawriter, sem DDL, sem EXECUTE: se a
-- API for comprometida, o atacante não consegue apagar tabelas, apagar o
-- log de auditoria, mexer em Character, nem ler a senha em texto puro.

-- >>> TROQUE A SENHA ABAIXO antes de rodar (gere com: openssl rand -base64 32).
-- >>> Não commite o arquivo com a senha real.
DECLARE @password NVARCHAR(128);
SET @password = N'TROQUE_ESTA_SENHA';

IF @password = N'TROQUE_ESTA_SENHA'
BEGIN
  RAISERROR('Defina @password antes de rodar o script.', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'mu_api')
BEGIN
  DECLARE @stmt NVARCHAR(400);
  SET @stmt = N'CREATE LOGIN [mu_api] WITH PASSWORD = N''' + REPLACE(@password, N'''', N'''''')
    + N''', DEFAULT_DATABASE = [MuOnline], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF';
  EXEC (@stmt);
END
GO

USE [MuOnline];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'mu_api')
  CREATE USER [mu_api] FOR LOGIN [mu_api] WITH DEFAULT_SCHEMA = [dbo];
GO

-- ---- Tabelas do jogo ------------------------------------------------------

GRANT SELECT, INSERT ON [dbo].[MEMB_INFO] TO [mu_api];
GRANT UPDATE ON [dbo].[MEMB_INFO] (
  [memb__pwd], [WebPasswordHash],        -- troca/reset de senha
  [mail_chek],                           -- confirmação de e-mail
  [memb_name],                           -- PATCH /account/me
  [bloc_code],                           -- ban/unban
  [Cash],                                -- créditos (Pix / compras)
  [Vip], [VipStartDate], [VipEndDate],   -- VIP
  [modi_days]
) TO [mu_api];

GRANT SELECT ON [dbo].[MEMB_STAT] TO [mu_api];
GRANT SELECT ON [dbo].[Character] TO [mu_api];

GRANT SELECT, INSERT ON [dbo].[warehouse] TO [mu_api];
GRANT UPDATE ON [dbo].[warehouse] ([Items]) TO [mu_api];

GRANT SELECT, INSERT, DELETE ON [dbo].[MEMB_AUTOPICK_ITEMS] TO [mu_api];

-- ---- Tabelas da API (migrations 0001-0006) --------------------------------

GRANT SELECT, INSERT ON [dbo].[WebAuditLog]          TO [mu_api];
GRANT SELECT, INSERT ON [dbo].[WebItemRedemptions]   TO [mu_api];
GRANT SELECT, INSERT ON [dbo].[WebBundleRedemptions] TO [mu_api];
GRANT SELECT, INSERT ON [dbo].[WebVipPurchases]      TO [mu_api];
GRANT SELECT, INSERT ON [dbo].[WebSupportReplies]    TO [mu_api];

GRANT SELECT, INSERT, DELETE ON [dbo].[WebShopBundleItems] TO [mu_api];

GRANT SELECT, INSERT, UPDATE ON [dbo].[WebAccountTokens]  TO [mu_api];
GRANT SELECT, INSERT, UPDATE ON [dbo].[WebRefreshTokens]  TO [mu_api];
GRANT SELECT, INSERT, UPDATE ON [dbo].[WebPixCharges]     TO [mu_api];
GRANT SELECT, INSERT, UPDATE ON [dbo].[WebCreditPackages] TO [mu_api];
GRANT SELECT, INSERT, UPDATE ON [dbo].[WebShopItems]      TO [mu_api];
GRANT SELECT, INSERT, UPDATE ON [dbo].[WebShopBundles]    TO [mu_api];
GRANT SELECT, INSERT, UPDATE ON [dbo].[WebSupportTickets] TO [mu_api];
GRANT SELECT, INSERT, UPDATE ON [dbo].[WebVipPlans]       TO [mu_api];

-- ---- Senha em texto puro: a API grava, mas nunca lê ------------------------
-- DENY de coluna prevalece sobre o GRANT SELECT da tabela: uma SQL injection
-- não consegue despejar memb__pwd. O UPDATE/INSERT da coluna continua
-- funcionando (não exigem SELECT nela).
DENY SELECT ON [dbo].[MEMB_INFO] ([memb__pwd]) TO [mu_api];
GO

-- ---- Conferência ------------------------------------------------------------
SELECT
  OBJECT_NAME(p.major_id)                  AS tabela,
  COL_NAME(p.major_id, p.minor_id)         AS coluna,
  p.permission_name                        AS permissao,
  p.state_desc                             AS estado
FROM sys.database_permissions p
WHERE p.grantee_principal_id = USER_ID(N'mu_api')
ORDER BY tabela, permissao, coluna;

SELECT r.name AS role_do_mu_api
FROM sys.database_role_members m
JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
WHERE m.member_principal_id = USER_ID(N'mu_api');  -- esperado: nenhuma linha
GO
