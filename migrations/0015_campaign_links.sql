-- Migration 0015 — links rastreáveis de campanha (mupro.vip/bonus/<codigo>),
-- NÃO aplicada automaticamente.
--
-- Mesma mecânica das migrations anteriores: idempotente, revise e aplique
-- manualmente. Não mexe em nenhuma tabela usada pelo gameserver.
--
--   * WebCampaigns: campanhas válidas. Cadastre e remova direto no banco
--     (não há tela de admin ainda). Remover a campanha encerra a captação de
--     visitas e de registros com aquele código.
--   * WebCampaignVisits: primeira visita de cada navegador (VisitorId, UUID
--     gerado no front e guardado no localStorage) a cada campanha.
--   * WebAccountReferrals: campanha atribuída à conta no registro (último
--     link /bonus/ que o navegador abriu antes de criar a conta).
--
-- Sem FK entre as tabelas de propósito: visitas e atribuições guardam o
-- código como texto e sobrevivem à remoção da campanha (o histórico fica).
-- Não reaproveite um código já usado em uma campanha nova: os números se
-- misturam. Sem FK para MEMB_INFO também (collation — docs/DB_NOTES.md).
--
-- Datas em UTC (SYSUTCDATETIME), como as demais tabelas Web*. Horário de
-- Brasília = UTC-3.
--
-- Ver docs/SECTION_13_CAMPAIGN_LINKS.md.

-- ============================================================
-- 1. WebCampaigns
-- ============================================================
IF OBJECT_ID(N'dbo.WebCampaigns', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebCampaigns] (
        [Code]      VARCHAR(30)   NOT NULL, -- minúsculo, [a-z0-9_-], 2 a 30 caracteres
        [Name]      NVARCHAR(100) NOT NULL,
        [CreatedAt] DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebCampaigns] PRIMARY KEY CLUSTERED ([Code] ASC),
        CONSTRAINT [CK_WebCampaigns_Code] CHECK (LEN([Code]) >= 2 AND [Code] NOT LIKE '%[^a-zA-Z0-9_-]%')
    );
END
GO

-- ============================================================
-- 2. WebCampaignVisits
-- ============================================================
IF OBJECT_ID(N'dbo.WebCampaignVisits', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebCampaignVisits] (
        [Id]           BIGINT IDENTITY(1,1) NOT NULL,
        [CampaignCode] VARCHAR(30)   NOT NULL,
        [VisitorId]    CHAR(36)      NOT NULL,
        [Ip]           VARCHAR(45)   NULL,
        [UserAgent]    NVARCHAR(255) NULL,
        [CreatedAt]    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebCampaignVisits] PRIMARY KEY CLUSTERED ([Id] ASC),
        -- Dedup: uma visita por navegador por campanha.
        CONSTRAINT [UQ_WebCampaignVisits_Code_Visitor] UNIQUE ([CampaignCode], [VisitorId])
    );

    CREATE INDEX [IX_WebCampaignVisits_Code_CreatedAt]
        ON [dbo].[WebCampaignVisits] ([CampaignCode], [CreatedAt]);
END
GO

-- ============================================================
-- 3. WebAccountReferrals
-- ============================================================
IF OBJECT_ID(N'dbo.WebAccountReferrals', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebAccountReferrals] (
        [Username]     VARCHAR(10)  NOT NULL, -- MEMB_INFO.memb___id
        [CampaignCode] VARCHAR(30)  NOT NULL,
        [VisitId]      BIGINT       NULL,     -- WebCampaignVisits.Id, quando achada
        [Ip]           VARCHAR(45)  NULL,     -- IP do registro
        [CreatedAt]    DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebAccountReferrals] PRIMARY KEY CLUSTERED ([Username] ASC)
    );

    CREATE INDEX [IX_WebAccountReferrals_Code_CreatedAt]
        ON [dbo].[WebAccountReferrals] ([CampaignCode], [CreatedAt]);
END
GO

-- ============================================================
-- 4. Permissões do login da API (ver migration 0009 / docs/DB_API_USER.md)
-- ============================================================
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'mu_api')
BEGIN
    GRANT SELECT ON [dbo].[WebCampaigns] TO [mu_api];
    GRANT SELECT, INSERT ON [dbo].[WebCampaignVisits] TO [mu_api];
    GRANT SELECT, INSERT ON [dbo].[WebAccountReferrals] TO [mu_api];
END
GO
