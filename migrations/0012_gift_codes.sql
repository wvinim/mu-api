-- Migration 0012 — gold de presente (chaves de resgate), NÃO aplicada
-- automaticamente.
--
-- Mesma mecânica das migrations anteriores: idempotente, revise e aplique
-- manualmente. Não mexe em nenhuma coluna usada pelo gameserver.
--
--   * WebPixCharges.IsGift: a cobrança é de presente (o webhook libera uma
--     chave em vez de creditar o Cash do comprador).
--   * WebGiftCodes: uma chave por cobrança de presente. Nasce
--     'awaiting_payment' junto com a cobrança, vira 'available' quando o Pix
--     é confirmado (mesma transação do webhook) e 'redeemed' no resgate
--     (mesma transação do crédito de Cash). 'cancelled' só pelo admin, e só
--     a partir de 'available'.
--
-- Ver docs/SECTION_10_GIFT_CODES.md.

-- ============================================================
-- 1. WebPixCharges.IsGift
-- ============================================================
IF COL_LENGTH(N'dbo.WebPixCharges', N'IsGift') IS NULL
    ALTER TABLE [dbo].[WebPixCharges]
        ADD [IsGift] BIT NOT NULL CONSTRAINT [DF_WebPixCharges_IsGift] DEFAULT 0;
GO

-- ============================================================
-- 2. WebGiftCodes
-- ============================================================
IF OBJECT_ID(N'dbo.WebGiftCodes', N'U') IS NULL
BEGIN
    DECLARE @collationAccount sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.MEMB_INFO') AND name = N'memb___id'
    );
    DECLARE @sql1 NVARCHAR(MAX) = N'
    CREATE TABLE [dbo].[WebGiftCodes] (
        [Id]                  BIGINT IDENTITY(1,1) NOT NULL,
        [Code]                VARCHAR(32)   NOT NULL, -- MUPRO-XXXX-XXXX-XXXX-XXXX (canônico, maiúsculo)
        [PixChargeId]         BIGINT        NOT NULL,
        [BuyerAccountId]      VARCHAR(10) COLLATE ' + @collationAccount + N' NOT NULL,
        [CreditsAmount]       INT           NOT NULL,
        [Status]              VARCHAR(20)   NOT NULL DEFAULT ''awaiting_payment'',
        [CreatedAt]           DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        [PaidAt]              DATETIME2     NULL,
        [RedeemedByAccountId] VARCHAR(10) COLLATE ' + @collationAccount + N' NULL,
        [RedeemedAt]          DATETIME2     NULL,
        [CancelledBy]         VARCHAR(10)   NULL, -- admin (só registro, sem FK)
        [CancelledAt]         DATETIME2     NULL,
        CONSTRAINT [PK_WebGiftCodes] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [CK_WebGiftCodes_Status]
            CHECK ([Status] IN (''awaiting_payment'', ''available'', ''redeemed'', ''cancelled'')),
        CONSTRAINT [FK_WebGiftCodes_WebPixCharges] FOREIGN KEY ([PixChargeId])
            REFERENCES [dbo].[WebPixCharges] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT [FK_WebGiftCodes_Buyer] FOREIGN KEY ([BuyerAccountId])
            REFERENCES [dbo].[MEMB_INFO] ([memb___id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT [FK_WebGiftCodes_RedeemedBy] FOREIGN KEY ([RedeemedByAccountId])
            REFERENCES [dbo].[MEMB_INFO] ([memb___id]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );';
    EXEC sp_executesql @sql1;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_WebGiftCodes_Code' AND object_id = OBJECT_ID(N'dbo.WebGiftCodes'))
    CREATE UNIQUE INDEX [UX_WebGiftCodes_Code] ON [dbo].[WebGiftCodes] ([Code]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_WebGiftCodes_PixChargeId' AND object_id = OBJECT_ID(N'dbo.WebGiftCodes'))
    CREATE UNIQUE INDEX [UX_WebGiftCodes_PixChargeId] ON [dbo].[WebGiftCodes] ([PixChargeId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebGiftCodes_BuyerAccountId' AND object_id = OBJECT_ID(N'dbo.WebGiftCodes'))
    CREATE INDEX [IX_WebGiftCodes_BuyerAccountId] ON [dbo].[WebGiftCodes] ([BuyerAccountId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebGiftCodes_RedeemedByAccountId' AND object_id = OBJECT_ID(N'dbo.WebGiftCodes'))
    CREATE INDEX [IX_WebGiftCodes_RedeemedByAccountId] ON [dbo].[WebGiftCodes] ([RedeemedByAccountId]);
GO

-- ============================================================
-- 3. Permissões do login da API (ver migration 0009 / docs/DB_API_USER.md)
-- ============================================================
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'mu_api')
    GRANT SELECT, INSERT, UPDATE ON [dbo].[WebGiftCodes] TO [mu_api];
GO
