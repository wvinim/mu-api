-- Migration 0001 — tabelas novas da API (auth), NÃO aplicada automaticamente.
--
-- Este banco é produção ao vivo, compartilhado com o gameserver em C++.
-- Revise este arquivo e aplique manualmente (ex: via SSMS ou sqlcmd) antes
-- de rodar a Seção 2 da API contra este banco. Nenhuma tabela existente é
-- alterada — apenas 3 tabelas novas, todas com FK para MEMB_INFO(memb___id).
--
-- Se existir um banco de staging/cópia, teste nele primeiro.
--
-- v2: corrige erro de collation (Msg 1757) — MEMB_INFO.memb___id usa uma
-- collation diferente da collation padrão do banco (comum em bancos de
-- MU migrados de servidor coreano). As colunas AccountId abaixo agora
-- usam COLLATE explícito, lido dinamicamente da própria coluna
-- memb___id, em vez de um valor chutado. Script idempotente: pode rodar
-- de novo com segurança mesmo já tendo criado WebAuditLog antes.

-- ============================================================
-- 1. Refresh tokens (JWT), com suporte a rotação e revogação
-- ============================================================
IF OBJECT_ID(N'dbo.WebRefreshTokens', N'U') IS NULL
BEGIN
    DECLARE @collation1 sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.MEMB_INFO') AND name = N'memb___id'
    );
    DECLARE @sql1 NVARCHAR(MAX) = N'
    CREATE TABLE [dbo].[WebRefreshTokens] (
        [Id]                   BIGINT IDENTITY(1,1) NOT NULL,
        [AccountId]            VARCHAR(10) COLLATE ' + @collation1 + N' NOT NULL,
        [TokenHash]            CHAR(64)      NOT NULL, -- sha256 hex do JWT completo
        [ExpiresAt]            DATETIME2     NOT NULL,
        [CreatedAt]            DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        [RevokedAt]            DATETIME2     NULL,
        [ReplacedByTokenHash]  CHAR(64)      NULL,
        [CreatedByIp]          VARCHAR(45)   NULL,
        [UserAgent]            VARCHAR(255)  NULL,
        CONSTRAINT [PK_WebRefreshTokens] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [FK_WebRefreshTokens_MEMB_INFO] FOREIGN KEY ([AccountId])
            REFERENCES [dbo].[MEMB_INFO] ([memb___id])
    );';
    EXEC sp_executesql @sql1;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_WebRefreshTokens_TokenHash' AND object_id = OBJECT_ID(N'dbo.WebRefreshTokens'))
    CREATE UNIQUE INDEX [UX_WebRefreshTokens_TokenHash] ON [dbo].[WebRefreshTokens] ([TokenHash]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebRefreshTokens_AccountId' AND object_id = OBJECT_ID(N'dbo.WebRefreshTokens'))
    CREATE INDEX [IX_WebRefreshTokens_AccountId] ON [dbo].[WebRefreshTokens] ([AccountId]);
GO

-- ============================================================
-- 2. Tokens de uso único: confirmação de e-mail e reset de senha
-- ============================================================
IF OBJECT_ID(N'dbo.WebAccountTokens', N'U') IS NULL
BEGIN
    DECLARE @collation2 sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.MEMB_INFO') AND name = N'memb___id'
    );
    DECLARE @sql2 NVARCHAR(MAX) = N'
    CREATE TABLE [dbo].[WebAccountTokens] (
        [Id]           BIGINT IDENTITY(1,1) NOT NULL,
        [AccountId]    VARCHAR(10) COLLATE ' + @collation2 + N' NOT NULL,
        [Purpose]      VARCHAR(20)   NOT NULL, -- ''email_confirm'' | ''password_reset''
        [TokenHash]    CHAR(64)      NOT NULL, -- sha256 hex do token bruto enviado por e-mail
        [ExpiresAt]    DATETIME2     NOT NULL,
        [UsedAt]       DATETIME2     NULL,
        [CreatedAt]    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        [CreatedByIp]  VARCHAR(45)   NULL,
        CONSTRAINT [PK_WebAccountTokens] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [CK_WebAccountTokens_Purpose] CHECK ([Purpose] IN (''email_confirm'', ''password_reset'')),
        CONSTRAINT [FK_WebAccountTokens_MEMB_INFO] FOREIGN KEY ([AccountId])
            REFERENCES [dbo].[MEMB_INFO] ([memb___id])
    );';
    EXEC sp_executesql @sql2;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_WebAccountTokens_TokenHash' AND object_id = OBJECT_ID(N'dbo.WebAccountTokens'))
    CREATE UNIQUE INDEX [UX_WebAccountTokens_TokenHash] ON [dbo].[WebAccountTokens] ([TokenHash]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebAccountTokens_AccountId_Purpose' AND object_id = OBJECT_ID(N'dbo.WebAccountTokens'))
    CREATE INDEX [IX_WebAccountTokens_AccountId_Purpose] ON [dbo].[WebAccountTokens] ([AccountId], [Purpose]);
GO

-- ============================================================
-- 3. Log de auditoria da API (login, troca de senha, ban, etc.)
--    Tabela própria da API — não mexe em nenhum log do gameserver.
--    Sem FK para MEMB_INFO (proposital, e sem coluna VARCHAR referenciando
--    memb___id diretamente em constraint — não sofre o problema de
--    collation), então não precisou de COLLATE dinâmico.
-- ============================================================
IF OBJECT_ID(N'dbo.WebAuditLog', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebAuditLog] (
        [Id]          BIGINT IDENTITY(1,1) NOT NULL,
        [AccountId]   VARCHAR(10)   NULL, -- pode ser NULL (ex: tentativa de login com usuário inexistente)
        [Username]    VARCHAR(10)   NULL, -- valor bruto tentado, útil quando AccountId não resolve
        [EventType]   VARCHAR(50)   NOT NULL, -- ex: 'auth.login.success', 'auth.login.failed', 'auth.register'
        [Success]     BIT           NOT NULL DEFAULT 1,
        [IpAddress]   VARCHAR(45)   NULL,
        [UserAgent]   VARCHAR(255)  NULL,
        [Details]     NVARCHAR(MAX) NULL, -- JSON livre com contexto adicional
        [CreatedAt]   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebAuditLog] PRIMARY KEY CLUSTERED ([Id] ASC)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebAuditLog_AccountId' AND object_id = OBJECT_ID(N'dbo.WebAuditLog'))
    CREATE INDEX [IX_WebAuditLog_AccountId] ON [dbo].[WebAuditLog] ([AccountId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebAuditLog_EventType_CreatedAt' AND object_id = OBJECT_ID(N'dbo.WebAuditLog'))
    CREATE INDEX [IX_WebAuditLog_EventType_CreatedAt] ON [dbo].[WebAuditLog] ([EventType], [CreatedAt]);
GO
