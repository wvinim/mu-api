-- Migration 0020 — mercado: preço mínimo de 10 para 3 gold. NÃO aplicada automaticamente.
--
-- 1. CK_WebMarketListings_Price: BETWEEN 10 AND 10000 -> BETWEEN 3 AND 10000.
--    Só afrouxa a regra: os anúncios que já existem (>= 10) continuam válidos.
-- 2. WebMarket_Create: a mesma checagem dentro da procedure (@price < 3).
--    O resto da procedure é idêntico ao da 0016.
--
-- A taxa NÃO muda: WebMarket_Buy calcula SellerReceived = floor(Price * 0,9),
-- Fee = Price - SellerReceived, isto é, 10% arredondado para cima, que dá
-- no mínimo 1 gold para qualquer preço >= 1 (3 -> 1, 10 -> 1, 11 -> 2).
--
-- Aplique ANTES de subir a API nova: com a API nova e o banco velho, um
-- anúncio de 3 a 9 gold passa na validação e a procedure recusa (erro 500
-- MARKET_INVALID_OPERATION, nada é alterado). O contrário (banco novo, API
-- velha) é seguro.
--
-- Idempotente: pode rodar de novo sem efeito.

IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = N'CK_WebMarketListings_Price'
             AND parent_object_id = OBJECT_ID(N'dbo.WebMarketListings'))
    ALTER TABLE [dbo].[WebMarketListings] DROP CONSTRAINT [CK_WebMarketListings_Price];
GO

ALTER TABLE [dbo].[WebMarketListings] WITH CHECK
    ADD CONSTRAINT [CK_WebMarketListings_Price] CHECK ([Price] BETWEEN 3 AND 10000);
GO

ALTER PROCEDURE [dbo].[WebMarket_Create]
    @account    VARCHAR(10),
    @vaultId    INT,
    @stored     BIT,               -- 0 = baú ativo, 1 = guardado
    @slot       INT,
    @oldItems   VARBINARY(1920),   -- o baú como a API leu (NULL se Items era NULL)
    @newItems   VARBINARY(1920),   -- o baú sem o item
    @itemBytes  BINARY(16),
    @itemGroup  TINYINT,
    @itemIndex  SMALLINT,
    @itemName   VARCHAR(50),
    @category   VARCHAR(20),
    @itemLevel  TINYINT,
    @excMask    TINYINT,
    @excCount   TINYINT,
    @hasSkill   BIT,
    @hasLuck    BIT,
    @addOption  TINYINT,
    @itemSerial BIGINT,
    @width      TINYINT,
    @height     TINYINT,
    @price      INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET LOCK_TIMEOUT 3000;
    SET DEADLOCK_PRIORITY LOW;

    DECLARE @maxListings INT = 10, @graceSeconds INT = 120, @days INT = 7;
    DECLARE @rows INT, @active INT, @name VARCHAR(10), @id BIGINT;

    IF @price IS NULL OR @price < 3 OR @price > 10000
    BEGIN SELECT 7 AS Result; RETURN; END

    IF dbo.WebMarket_SlotChangeOk(@oldItems, @newItems, @slot, @itemBytes, 'remove') = 0
    BEGIN SELECT 7 AS Result; RETURN; END

    IF EXISTS (SELECT 1 FROM MEMB_STAT WHERE memb___id = @account
               AND (ConnectStat <> 0 OR DisConnectTM > DATEADD(SECOND, -@graceSeconds, GETDATE())))
    BEGIN SELECT 1 AS Result; RETURN; END

    BEGIN TRAN;

    -- Limite por conta. A trava é só na tabela do mercado (faixa da conta,
    -- via IX_WebMarketListings_Seller): segura dois anúncios simultâneos.
    SELECT @active = COUNT(*)
    FROM dbo.WebMarketListings WITH (UPDLOCK, HOLDLOCK)
    WHERE SellerAccount = @account AND Status = 'active';

    IF @active >= @maxListings
    BEGIN ROLLBACK; SELECT 4 AS Result; RETURN; END

    IF @stored = 0
        UPDATE warehouse SET Items = @newItems
        WHERE AccountID = @account AND VaultID = @vaultId
          AND ((@oldItems IS NULL AND Items IS NULL) OR (Items = @oldItems AND DATALENGTH(Items) = DATALENGTH(@oldItems)));
    ELSE
        UPDATE Extwarehouse SET Items = @newItems
        WHERE AccountID = @account AND VaultID = @vaultId
          AND AccountID COLLATE Latin1_General_CS_AS = @account -- ver nota de collation
          AND ((@oldItems IS NULL AND Items IS NULL) OR (Items = @oldItems AND DATALENGTH(Items) = DATALENGTH(@oldItems)));
    SET @rows = @@ROWCOUNT;

    IF @rows <> 1
    BEGIN ROLLBACK; SELECT CASE WHEN @rows > 1 THEN 2 ELSE 3 END AS Result; RETURN; END

    SELECT @name = memb_name FROM MEMB_INFO WHERE memb___id = @account;

    INSERT INTO dbo.WebMarketListings
        (SellerAccount, SellerName, SourceVault, SourceStored, SourceSlot, ItemBytes,
         ItemGroup, ItemIndex, ItemName, Category, ItemLevel, ExcMask, ExcCount,
         HasSkill, HasLuck, AddOption, ItemSerial, Width, Height,
         Price, Status, ExpiresAt)
    VALUES
        (@account, @name, @vaultId, @stored, @slot, @itemBytes,
         @itemGroup, @itemIndex, @itemName, @category, @itemLevel, @excMask, @excCount,
         @hasSkill, @hasLuck, @addOption, @itemSerial, @width, @height,
         @price, 'active', DATEADD(DAY, @days, SYSUTCDATETIME()));
    SET @id = SCOPE_IDENTITY();

    COMMIT;
    SELECT 0 AS Result, @id AS ListingId;
END
GO
