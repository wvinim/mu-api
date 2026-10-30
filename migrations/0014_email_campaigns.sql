-- Migration 0014 — campanhas de e-mail (divulgação) e descadastro, NÃO
-- aplicada automaticamente.
--
-- Mesma mecânica das migrations anteriores: idempotente, revise e aplique
-- manualmente. Não mexe em nenhuma tabela usada pelo gameserver.
--
--   * WebEmailCampaignSends: um registro por (campanha, e-mail) enviado ou
--     que falhou. É o que impede reenviar a mesma campanha para quem já
--     recebeu se o envio for disparado de novo (ou retomado após falha).
--   * WebEmailUnsubscribes: e-mails que pediram para não receber mais
--     divulgação. E-mails transacionais (confirmação, reset de senha,
--     presente) continuam sendo enviados normalmente.
--
-- Sem FK para MEMB_INFO de propósito: o registro é por e-mail (várias contas
-- antigas podem dividir o mesmo e-mail) e o AccountId é só informativo.
-- E-mails gravados sempre em minúsculo.
--
-- Ver docs/SECTION_12_EMAIL_CAMPAIGNS.md.

-- ============================================================
-- 1. WebEmailCampaignSends
-- ============================================================
IF OBJECT_ID(N'dbo.WebEmailCampaignSends', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebEmailCampaignSends] (
        [CampaignKey] VARCHAR(40)   NOT NULL,
        [Email]       VARCHAR(50)   NOT NULL,
        [AccountId]   VARCHAR(10)   NULL,     -- conta usada na saudação (só registro)
        [Status]      VARCHAR(10)   NOT NULL, -- 'sent' | 'failed'
        [Error]       NVARCHAR(255) NULL,
        [SentAt]      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebEmailCampaignSends] PRIMARY KEY CLUSTERED ([CampaignKey] ASC, [Email] ASC),
        CONSTRAINT [CK_WebEmailCampaignSends_Status] CHECK ([Status] IN ('sent', 'failed'))
    );
END
GO

-- ============================================================
-- 2. WebEmailUnsubscribes
-- ============================================================
IF OBJECT_ID(N'dbo.WebEmailUnsubscribes', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebEmailUnsubscribes] (
        [Email]          VARCHAR(50) NOT NULL,
        [UnsubscribedAt] DATETIME2   NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebEmailUnsubscribes] PRIMARY KEY CLUSTERED ([Email] ASC)
    );
END
GO

-- ============================================================
-- 3. Permissões do login da API (ver migration 0009 / docs/DB_API_USER.md)
-- ============================================================
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'mu_api')
BEGIN
    GRANT SELECT, INSERT, UPDATE ON [dbo].[WebEmailCampaignSends] TO [mu_api];
    GRANT SELECT, INSERT ON [dbo].[WebEmailUnsubscribes] TO [mu_api];
END
GO
