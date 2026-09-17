-- Migration 0006 — catálogo de planos VIP + histórico de compras, NÃO
-- aplicada automaticamente.
--
-- Mesma mecânica das migrations anteriores: idempotente, revise e aplique
-- manualmente. NÃO mexe em MEMB_INFO (Vip/VipStartDate/VipEndDate já
-- existem e já são usadas pelo gameserver — só passamos a escrever nelas
-- pela API a partir de agora). NÃO mexe em MEMB_AUTOPICK_ITEMS — essa
-- tabela já existe (criada fora desta migration, ver docs/VIP_SYSTEM.md).
--
-- Ver docs/SECTION_9_VIP.md para o desenho completo da feature.

-- ============================================================
-- 1. Catálogo de planos VIP — sempre exatamente 3 linhas (tier 1/2/3),
--    admin só edita PriceCredits/Active (ver adminController.updateVipPlan).
-- ============================================================
IF OBJECT_ID(N'dbo.WebVipPlans', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebVipPlans] (
        [Id]            INT IDENTITY(1,1) NOT NULL,
        [Tier]          TINYINT       NOT NULL, -- 1 = Vip, 2 = Super Vip, 3 = Mega Vip
        [Name]          VARCHAR(50)   NOT NULL,
        [PriceCredits]  INT           NOT NULL,
        [DurationDays]  INT           NOT NULL DEFAULT 30,
        [Active]        BIT           NOT NULL DEFAULT 1,
        [CreatedAt]     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebVipPlans] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [UQ_WebVipPlans_Tier] UNIQUE ([Tier])
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM [dbo].[WebVipPlans] WHERE [Tier] = 1)
    INSERT INTO [dbo].[WebVipPlans] ([Tier], [Name], [PriceCredits], [DurationDays], [Active])
    VALUES (1, N'Vip', 60, 30, 1);
GO

IF NOT EXISTS (SELECT 1 FROM [dbo].[WebVipPlans] WHERE [Tier] = 2)
    INSERT INTO [dbo].[WebVipPlans] ([Tier], [Name], [PriceCredits], [DurationDays], [Active])
    VALUES (2, N'Super Vip', 120, 30, 1);
GO

IF NOT EXISTS (SELECT 1 FROM [dbo].[WebVipPlans] WHERE [Tier] = 3)
    INSERT INTO [dbo].[WebVipPlans] ([Tier], [Name], [PriceCredits], [DurationDays], [Active])
    VALUES (3, N'Mega Vip', 240, 30, 1);
GO

-- ============================================================
-- 2. Histórico de compras de VIP (Cash -> Vip/VipStartDate/VipEndDate
--    em MEMB_INFO). Guarda um "snapshot" de tier/preço/duração no
--    momento da compra — se o admin mudar o preço do plano depois, o
--    histórico de compras antigas não muda retroativamente.
-- ============================================================
IF OBJECT_ID(N'dbo.WebVipPurchases', N'U') IS NULL
BEGIN
    DECLARE @collationAccount sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.MEMB_INFO') AND name = N'memb___id'
    );
    DECLARE @sql1 NVARCHAR(MAX) = N'
    CREATE TABLE [dbo].[WebVipPurchases] (
        [Id]            BIGINT IDENTITY(1,1) NOT NULL,
        [AccountId]     VARCHAR(10) COLLATE ' + @collationAccount + N' NOT NULL,
        [PlanId]        INT           NOT NULL,
        [Tier]          TINYINT       NOT NULL,
        [PriceCredits]  INT           NOT NULL,
        [DurationDays]  INT           NOT NULL,
        [CreatedAt]     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebVipPurchases] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [FK_WebVipPurchases_MEMB_INFO] FOREIGN KEY ([AccountId])
            REFERENCES [dbo].[MEMB_INFO] ([memb___id]),
        CONSTRAINT [FK_WebVipPurchases_WebVipPlans] FOREIGN KEY ([PlanId])
            REFERENCES [dbo].[WebVipPlans] ([Id])
    );';
    EXEC sp_executesql @sql1;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebVipPurchases_AccountId' AND object_id = OBJECT_ID(N'dbo.WebVipPurchases'))
    CREATE INDEX [IX_WebVipPurchases_AccountId] ON [dbo].[WebVipPurchases] ([AccountId]);
GO
