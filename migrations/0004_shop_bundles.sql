-- Migration 0004 — pacotes (bundles) da loja: vender vários itens do
-- catálogo (WebShopItems) como um produto único, com preço próprio.
-- NÃO aplicada automaticamente — mesma mecânica das migrations
-- anteriores: idempotente (IF OBJECT_ID IS NULL), revise e aplique
-- manualmente. COLLATE dinâmico nas colunas que referenciam
-- MEMB_INFO(memb___id) e Character(Name) — ver docs/DB_NOTES.md.
--
-- Motivação: já era possível cadastrar itens individuais (ex: "Bundle of
-- Jewel of Bless", "Kundun Box") em WebShopItems, mas não vendê-los juntos
-- como um pacote único (ex: "10x Jewel Pack + 10x Kundun Box" por um preço
-- fixo). Itens que só devem existir dentro de um pacote (não à venda
-- avulsa) continuam em WebShopItems — basta cadastrá-los com Active = 0
-- lá; eles continuam utilizáveis como componente de um pacote (a busca de
-- componente não filtra por Active), só somem do catálogo avulso em
-- GET /shop/items.

-- ============================================================
-- 1. Catálogo de pacotes (produto vendável, preço próprio)
-- ============================================================
IF OBJECT_ID(N'dbo.WebShopBundles', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebShopBundles] (
        [Id]           INT IDENTITY(1,1) NOT NULL,
        [Name]         VARCHAR(50)   NOT NULL,
        [Description]  VARCHAR(255)  NULL,
        [PriceCredits] INT           NOT NULL,
        [Active]       BIT           NOT NULL DEFAULT 1,
        [CreatedAt]    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebShopBundles] PRIMARY KEY CLUSTERED ([Id] ASC)
    );
END
GO

-- ============================================================
-- 2. Composição do pacote — quais itens de WebShopItems ele contém e
--    quantas instâncias (slots) de cada um conceder na compra.
-- ============================================================
IF OBJECT_ID(N'dbo.WebShopBundleItems', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebShopBundleItems] (
        [Id]         INT IDENTITY(1,1) NOT NULL,
        [BundleId]   INT      NOT NULL,
        [ShopItemId] INT      NOT NULL,
        [Quantity]   TINYINT  NOT NULL DEFAULT 1, -- quantas instâncias (slots) desse item o pacote concede
        CONSTRAINT [PK_WebShopBundleItems] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [UQ_WebShopBundleItems_Bundle_Item] UNIQUE ([BundleId], [ShopItemId]),
        CONSTRAINT [FK_WebShopBundleItems_WebShopBundles] FOREIGN KEY ([BundleId])
            REFERENCES [dbo].[WebShopBundles] ([Id]),
        CONSTRAINT [FK_WebShopBundleItems_WebShopItems] FOREIGN KEY ([ShopItemId])
            REFERENCES [dbo].[WebShopItems] ([Id])
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebShopBundleItems_BundleId' AND object_id = OBJECT_ID(N'dbo.WebShopBundleItems'))
    CREATE INDEX [IX_WebShopBundleItems_BundleId] ON [dbo].[WebShopBundleItems] ([BundleId]);
GO

-- ============================================================
-- 3. Resgates de pacote (Cash -> N itens inseridos no Inventory).
--    Uma compra de pacote grava UMA linha aqui (o preço cobrado é o do
--    pacote, não a soma dos componentes); o detalhe de quais
--    itens/slots entraram fica no WebAuditLog
--    (eventType 'shop.bundle_redeemed'), no mesmo padrão já usado para
--    resgate de item avulso.
-- ============================================================
IF OBJECT_ID(N'dbo.WebBundleRedemptions', N'U') IS NULL
BEGIN
    DECLARE @collationAccount sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.MEMB_INFO') AND name = N'memb___id'
    );
    DECLARE @collationChar sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.Character') AND name = N'Name'
    );
    DECLARE @sql1 NVARCHAR(MAX) = N'
    CREATE TABLE [dbo].[WebBundleRedemptions] (
        [Id]            BIGINT IDENTITY(1,1) NOT NULL,
        [AccountId]     VARCHAR(10) COLLATE ' + @collationAccount + N' NOT NULL,
        [CharacterName] VARCHAR(10) COLLATE ' + @collationChar + N' NOT NULL,
        [BundleId]      INT           NOT NULL,
        [PriceCredits]  INT           NOT NULL,
        [CreatedAt]     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebBundleRedemptions] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [FK_WebBundleRedemptions_MEMB_INFO] FOREIGN KEY ([AccountId])
            REFERENCES [dbo].[MEMB_INFO] ([memb___id]),
        CONSTRAINT [FK_WebBundleRedemptions_Character] FOREIGN KEY ([CharacterName])
            REFERENCES [dbo].[Character] ([Name]),
        CONSTRAINT [FK_WebBundleRedemptions_WebShopBundles] FOREIGN KEY ([BundleId])
            REFERENCES [dbo].[WebShopBundles] ([Id])
    );';
    EXEC sp_executesql @sql1;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebBundleRedemptions_AccountId' AND object_id = OBJECT_ID(N'dbo.WebBundleRedemptions'))
    CREATE INDEX [IX_WebBundleRedemptions_AccountId] ON [dbo].[WebBundleRedemptions] ([AccountId]);
GO
