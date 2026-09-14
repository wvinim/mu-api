-- Migration 0002 — tabelas da Loja/Créditos, NÃO aplicada automaticamente.
--
-- Mesmas regras da migration 0001: revise e aplique manualmente. Idempotente
-- (IF OBJECT_ID IS NULL) e usa COLLATE dinâmico nas colunas que referenciam
-- MEMB_INFO(memb___id) e Character(Name) — ver docs/DB_NOTES.md sobre o
-- erro de collation já encontrado na migration 0001.

-- ============================================================
-- 1. Catálogo de pacotes de créditos (comprados via Pix)
-- ============================================================
IF OBJECT_ID(N'dbo.WebCreditPackages', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebCreditPackages] (
        [Id]            INT IDENTITY(1,1) NOT NULL,
        [Name]          VARCHAR(50)   NOT NULL,
        [PriceCents]    INT           NOT NULL, -- preço em centavos (evita ponto flutuante)
        [CreditsAmount] INT           NOT NULL, -- quantidade de Cash creditada em MEMB_INFO.Cash
        [Active]        BIT           NOT NULL DEFAULT 1,
        [CreatedAt]     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebCreditPackages] PRIMARY KEY CLUSTERED ([Id] ASC)
    );
END
GO

-- ============================================================
-- 2. Catálogo de itens resgatáveis com créditos (inseridos no
--    Inventory do personagem — ver docs/INVENTORY_BYTE_FORMAT.md)
-- ============================================================
IF OBJECT_ID(N'dbo.WebShopItems', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebShopItems] (
        [Id]           INT IDENTITY(1,1) NOT NULL,
        [Name]         VARCHAR(50)   NOT NULL,
        [Description]  VARCHAR(255)  NULL,
        [PriceCredits] INT           NOT NULL, -- custo em Cash (créditos), não em dinheiro real
        [ItemGroup]    TINYINT       NOT NULL, -- ver fórmula itemGet(group, index) no doc de inventário
        [ItemIndex]    SMALLINT      NOT NULL,
        [ItemLevel]    TINYINT       NOT NULL DEFAULT 0,
        [Quantity]     TINYINT       NOT NULL DEFAULT 1,
        [Active]       BIT           NOT NULL DEFAULT 1,
        [CreatedAt]    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebShopItems] PRIMARY KEY CLUSTERED ([Id] ASC)
    );
END
GO

-- ============================================================
-- 3. Cobranças Pix criadas (rastreamento + idempotência do webhook)
-- ============================================================
IF OBJECT_ID(N'dbo.WebPixCharges', N'U') IS NULL
BEGIN
    DECLARE @collation1 sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.MEMB_INFO') AND name = N'memb___id'
    );
    DECLARE @sql1 NVARCHAR(MAX) = N'
    CREATE TABLE [dbo].[WebPixCharges] (
        [Id]            BIGINT IDENTITY(1,1) NOT NULL,
        [AccountId]     VARCHAR(10) COLLATE ' + @collation1 + N' NOT NULL,
        [PackageId]     INT           NOT NULL,
        [TxId]          VARCHAR(35)   NOT NULL,
        [AmountCents]   INT           NOT NULL,
        [CreditsAmount] INT           NOT NULL,
        [Status]        VARCHAR(20)   NOT NULL DEFAULT ''pending'',
        [CreatedAt]     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        [PaidAt]        DATETIME2     NULL,
        CONSTRAINT [PK_WebPixCharges] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [CK_WebPixCharges_Status] CHECK ([Status] IN (''pending'', ''paid'', ''expired'', ''failed'')),
        CONSTRAINT [FK_WebPixCharges_MEMB_INFO] FOREIGN KEY ([AccountId])
            REFERENCES [dbo].[MEMB_INFO] ([memb___id]),
        CONSTRAINT [FK_WebPixCharges_WebCreditPackages] FOREIGN KEY ([PackageId])
            REFERENCES [dbo].[WebCreditPackages] ([Id])
    );';
    EXEC sp_executesql @sql1;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_WebPixCharges_TxId' AND object_id = OBJECT_ID(N'dbo.WebPixCharges'))
    CREATE UNIQUE INDEX [UX_WebPixCharges_TxId] ON [dbo].[WebPixCharges] ([TxId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebPixCharges_AccountId' AND object_id = OBJECT_ID(N'dbo.WebPixCharges'))
    CREATE INDEX [IX_WebPixCharges_AccountId] ON [dbo].[WebPixCharges] ([AccountId]);
GO

-- ============================================================
-- 4. Resgates de itens (Cash -> item inserido no Inventory)
-- ============================================================
IF OBJECT_ID(N'dbo.WebItemRedemptions', N'U') IS NULL
BEGIN
    DECLARE @collationAccount sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.MEMB_INFO') AND name = N'memb___id'
    );
    DECLARE @collationChar sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.Character') AND name = N'Name'
    );
    DECLARE @sql2 NVARCHAR(MAX) = N'
    CREATE TABLE [dbo].[WebItemRedemptions] (
        [Id]             BIGINT IDENTITY(1,1) NOT NULL,
        [AccountId]      VARCHAR(10) COLLATE ' + @collationAccount + N' NOT NULL,
        [CharacterName]  VARCHAR(10) COLLATE ' + @collationChar + N' NOT NULL,
        [ShopItemId]     INT           NOT NULL,
        [PriceCredits]   INT           NOT NULL,
        [Slot]           TINYINT       NOT NULL,
        [CreatedAt]      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebItemRedemptions] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [FK_WebItemRedemptions_MEMB_INFO] FOREIGN KEY ([AccountId])
            REFERENCES [dbo].[MEMB_INFO] ([memb___id]),
        CONSTRAINT [FK_WebItemRedemptions_Character] FOREIGN KEY ([CharacterName])
            REFERENCES [dbo].[Character] ([Name]),
        CONSTRAINT [FK_WebItemRedemptions_WebShopItems] FOREIGN KEY ([ShopItemId])
            REFERENCES [dbo].[WebShopItems] ([Id])
    );';
    EXEC sp_executesql @sql2;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebItemRedemptions_AccountId' AND object_id = OBJECT_ID(N'dbo.WebItemRedemptions'))
    CREATE INDEX [IX_WebItemRedemptions_AccountId] ON [dbo].[WebItemRedemptions] ([AccountId]);
GO
