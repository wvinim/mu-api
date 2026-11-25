-- Migration 0018 — campanha "story no Instagram" (40 gold por Instagram),
-- NÃO aplicada automaticamente.
--
-- Mesma mecânica das migrations anteriores: idempotente, revise e aplique
-- manualmente ANTES do deploy da API. Não mexe em nenhuma tabela usada pelo
-- gameserver (o crédito de gold é um UPDATE em MEMB_INFO.Cash, mesmo GRANT
-- já usado pelas chaves de presente).
--
--   * WebInstagramLinks: conta do jogo <-> conta do Instagram (IGSID = ID do
--     Instagram da pessoa no nosso perfil, chega no webhook). Um IGSID só pode
--     estar vinculado a uma conta por vez; uma conta tem no máximo um IGSID.
--   * WebInstagramLinkCodes: código que o jogador manda no Direct do
--     @muproserver para provar que é dono do @. Um código ativo por conta.
--   * WebInstagramRewards: prêmio pago. PK no IGSID = cada Instagram é
--     premiado UMA VEZ na vida, mesmo se desvincular e vincular a outra conta.
--   * WebInstagramMentions: toda menção em story recebida (idempotência pelo
--     `mid` da Meta, que reenvia o webhook por até 36h) e o resultado.
--
-- Sem FK para MEMB_INFO (collation — docs/DB_NOTES.md), como as demais
-- tabelas Web*. Datas em UTC (SYSUTCDATETIME). Horário de Brasília = UTC-3.
--
-- Ver docs/SECTION_15_INSTAGRAM.md.

-- ============================================================
-- 1. WebInstagramLinks
-- ============================================================
IF OBJECT_ID(N'dbo.WebInstagramLinks', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebInstagramLinks] (
        [Username]   VARCHAR(10)  NOT NULL, -- MEMB_INFO.memb___id
        [Igsid]      VARCHAR(32)  NOT NULL,
        [IgUsername] VARCHAR(64)  NULL,     -- @ no momento do vínculo (pode mudar depois)
        [LinkedAt]   DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebInstagramLinks] PRIMARY KEY CLUSTERED ([Username] ASC),
        CONSTRAINT [UQ_WebInstagramLinks_Igsid] UNIQUE ([Igsid])
    );
END
GO

-- ============================================================
-- 2. WebInstagramLinkCodes
-- ============================================================
IF OBJECT_ID(N'dbo.WebInstagramLinkCodes', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebInstagramLinkCodes] (
        [Code]        VARCHAR(16)  NOT NULL, -- MUPRO-XXXXXX
        [Username]    VARCHAR(10)  NOT NULL,
        [CreatedAt]   DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        [ExpiresAt]   DATETIME2    NOT NULL,
        [UsedAt]      DATETIME2    NULL,
        [UsedByIgsid] VARCHAR(32)  NULL,     -- reenvio do mesmo Direct = mesmo resultado
        CONSTRAINT [PK_WebInstagramLinkCodes] PRIMARY KEY CLUSTERED ([Code] ASC)
    );

    CREATE INDEX [IX_WebInstagramLinkCodes_Username]
        ON [dbo].[WebInstagramLinkCodes] ([Username]);
END
GO

-- ============================================================
-- 3. WebInstagramRewards
-- ============================================================
IF OBJECT_ID(N'dbo.WebInstagramRewards', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebInstagramRewards] (
        [Igsid]         VARCHAR(32)  NOT NULL,
        [Username]      VARCHAR(10)  NOT NULL, -- conta que recebeu o gold
        [IgUsername]    VARCHAR(64)  NULL,
        [Amount]        INT          NOT NULL,
        [FollowerCount] INT          NULL,
        [MentionMid]    VARCHAR(255) NOT NULL,
        [CreatedAt]     DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebInstagramRewards] PRIMARY KEY CLUSTERED ([Igsid] ASC)
    );

    CREATE INDEX [IX_WebInstagramRewards_Username]
        ON [dbo].[WebInstagramRewards] ([Username]);
END
GO

-- ============================================================
-- 4. WebInstagramMentions
-- ============================================================
-- Status: received | rewarded | already_rewarded | unlinked |
--         low_followers | disabled | profile_error
IF OBJECT_ID(N'dbo.WebInstagramMentions', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebInstagramMentions] (
        [Mid]           VARCHAR(255)  NOT NULL, -- message.mid da Meta
        [Igsid]         VARCHAR(32)   NOT NULL,
        [IgUsername]    VARCHAR(64)   NULL,
        [Username]      VARCHAR(10)   NULL,     -- conta vinculada no momento do processamento
        [MediaUrl]      VARCHAR(2048) NULL,     -- URL temporária da Meta (expira)
        [Status]        VARCHAR(20)   NOT NULL,
        [FollowerCount] INT           NULL,
        [CreatedAt]     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        [UpdatedAt]     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebInstagramMentions] PRIMARY KEY CLUSTERED ([Mid] ASC)
    );

    CREATE INDEX [IX_WebInstagramMentions_Igsid_CreatedAt]
        ON [dbo].[WebInstagramMentions] ([Igsid], [CreatedAt]);
END
GO

-- ============================================================
-- 5. Permissões do login da API (ver migration 0009 / docs/DB_API_USER.md)
-- ============================================================
-- MEMB_INFO.Cash já tem UPDATE para o mu_api (chaves de presente / loja).
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'mu_api')
BEGIN
    GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[WebInstagramLinks] TO [mu_api];
    GRANT SELECT, INSERT, UPDATE, DELETE ON [dbo].[WebInstagramLinkCodes] TO [mu_api];
    GRANT SELECT, INSERT ON [dbo].[WebInstagramRewards] TO [mu_api];
    GRANT SELECT, INSERT, UPDATE ON [dbo].[WebInstagramMentions] TO [mu_api];
END
GO
