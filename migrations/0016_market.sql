-- Migration 0016 — mercado de itens entre jogadores, NÃO aplicada automaticamente.
--
-- Rode ANTES a 0016_market_precheck.sql (só leitura) e confira as premissas.
-- Idempotente: revise e aplique manualmente, de preferência em horário de
-- pouco movimento (não há passo pesado, mas é o hábito do projeto).
-- Ver docs/SECTION_14_MARKET.md.
--
-- ============================================================
-- SEGURANÇA EM RELAÇÃO AO JOGO (o motivo de cada escolha abaixo)
-- ============================================================
--
-- A. Nenhuma estrutura do jogo muda. Esta migration só CRIA coisas novas
--    (1 tabela Web*, 5 procedures) e dá GRANTs. Nada de ALTER/DROP em
--    warehouse, Extwarehouse, MEMB_INFO ou MEMB_STAT.
--
-- B. Nenhuma trava atravessa a rede. A API lê o baú SEM trava, calcula o
--    baú novo em memória e chama UMA procedure. Toda a transação roda dentro
--    do SQL Server, numa única ida e volta (milissegundos). Não existe
--    "BEGIN TRAN na API, espera, COMMIT depois".
--
-- C. Escrita otimista ("compare-and-swap"). O UPDATE do baú só acontece se
--    o conteúdo ainda for EXATAMENTE o que a API leu (Items = @oldItems).
--    Se qualquer coisa mudou o baú no meio tempo, nada é gravado e a API
--    devolve "tente de novo". Por isso não usamos UPDLOCK/HOLDLOCK em
--    warehouse (que não tem índice: HOLDLOCK ali travaria a tabela inteira).
--
-- D. A API sempre perde a disputa:
--      SET LOCK_TIMEOUT 3000      -> espera no máximo 3s por uma trava e desiste
--      SET DEADLOCK_PRIORITY LOW  -> num deadlock com o jogo, a vítima é o mercado
--    Em qualquer erro, XACT_ABORT desfaz tudo (nem gold nem item mudam).
--
-- E. Conta offline, com folga. Baú só é tocado se a conta dona do baú está
--    com ConnectStat = 0 E desconectou há mais de 2 minutos (DisConnectTM).
--    A folga cobre o salvamento do baú que o DataServer faz no logout: sem
--    ela, um salvamento atrasado poderia sobrescrever o que o mercado gravou.
--    Se a conta logar logo depois do mercado gravar, o jogo só lê o baú
--    quando o jogador abre o NPC, então ele já lê o baú atualizado.
--
-- F. Só um item muda por operação. A procedure confere byte a byte que o
--    baú novo é igual ao antigo, exceto os 16 bytes do slot do item, e que
--    esses 16 bytes são o item do anúncio. Um bug na API não consegue
--    apagar ou duplicar outros itens.
--
-- G. Menor privilégio. O login mu_api ganha EXECUTE nas procedures e SELECT
--    na tabela do mercado. NÃO ganha UPDATE em Extwarehouse nem UPDATE
--    direto em WebMarketListings: só escreve por dentro das procedures
--    (ownership chaining, tudo dbo). Ganha SELECT em Extwarehouse (colunas
--    do baú) para listar os baús guardados — a 0011 tinha revogado.
--
-- Collation (pré-checagem de 2026-11-24): memb___id, warehouse.AccountID e
-- MEMB_STAT são Latin1_General_CS_AS (maiúscula importa: "Joao" e "joao" são
-- contas diferentes), mas Extwarehouse.AccountID é CI_AS e o banco é
-- compatibility level 80. As colunas de conta do mercado são CS_AS e toda
-- comparação de conta entre variáveis ou com Extwarehouse força CS_AS; senão
-- "joao" poderia retirar o anúncio de "Joao" ou gravar no baú guardado dele.
-- Em Extwarehouse a igualdade CI fica para o índice (seek) e a CS filtra.
--
-- DisConnectTM é smalldatetime (precisão de minuto): a folga real de
-- 2 minutos fica entre ~1,5 e ~2,5 minutos.
--
-- Datas do mercado em UTC (SYSUTCDATETIME), como as demais tabelas Web*.
-- DisConnectTM do MEMB_STAT é hora local do servidor (GETDATE).
--
-- Códigos de retorno (coluna Result) das procedures:
--   0 ok
--   1 conta online ou desconectou há menos de 2 minutos
--   2 baú não encontrado (ou conta com mais de uma linha de baú ativo)
--   3 o baú mudou desde a leitura (a API relê e tenta de novo)
--   4 limite de 10 anúncios atingido
--   5 anúncio indisponível (já vendido, retirado, expirado ou não é seu)
--   6 gold insuficiente
--   7 dados inválidos (preço fora da faixa, slot ou bytes do baú inconsistentes)
--   8 não pode comprar o próprio anúncio

USE [MuOnline]
GO

-- ============================================================
-- 1. WebMarketListings
-- ============================================================
IF OBJECT_ID(N'dbo.WebMarketListings', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[WebMarketListings] (
        [Id]             BIGINT IDENTITY(1,1) NOT NULL,
        [SellerAccount]  VARCHAR(10)  COLLATE Latin1_General_CS_AS NOT NULL, -- MEMB_INFO.memb___id (nunca exibido)
        [SellerName]     VARCHAR(10)  NULL,     -- MEMB_INFO.memb_name no momento do anúncio
        [SourceVault]    INT          NOT NULL, -- baú de onde o item saiu
        [SourceStored]   BIT          NOT NULL, -- 0 = baú ativo (warehouse), 1 = guardado (Extwarehouse)
        [SourceSlot]     TINYINT      NOT NULL,

        -- O item exatamente como estava no baú: volta idêntico (serial, opções).
        [ItemBytes]      BINARY(16)   NOT NULL,

        -- Colunas decodificadas pela API, só para busca e exibição.
        [ItemGroup]      TINYINT      NOT NULL,
        [ItemIndex]      SMALLINT     NOT NULL,
        [ItemName]       VARCHAR(50)  NOT NULL,
        [Category]       VARCHAR(20)  NOT NULL, -- ex.: 'sword', 'set', 'shield', 'ring', 'wing'
        [ItemLevel]      TINYINT      NOT NULL, -- +0..+13
        [ExcMask]        TINYINT      NOT NULL, -- bits das 6 opções excelentes
        [ExcCount]       TINYINT      NOT NULL,
        [HasSkill]       BIT          NOT NULL,
        [HasLuck]        BIT          NOT NULL,
        [AddOption]      TINYINT      NOT NULL, -- 0..7 (x4 / x5 conforme o item)
        [ItemSerial]     BIGINT       NOT NULL, -- 0 = sem serial
        [Width]          TINYINT      NOT NULL,
        [Height]         TINYINT      NOT NULL,

        [Price]          INT          NOT NULL,
        [Status]         VARCHAR(10)  NOT NULL DEFAULT 'active', -- active | sold | returned
        [CreatedAt]      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        [ExpiresAt]      DATETIME2    NOT NULL, -- "expirado" = active e ExpiresAt <= agora
        [ClosedAt]       DATETIME2    NULL,

        -- Venda
        [BuyerAccount]   VARCHAR(10)  COLLATE Latin1_General_CS_AS NULL,
        [BuyerName]      VARCHAR(10)  NULL,
        [SellerReceived] INT          NULL, -- floor(Price * 0,9)
        [Fee]            INT          NULL, -- Price - SellerReceived
        -- Destino do item na venda ou na retirada
        [DestVault]      INT          NULL,
        [DestStored]     BIT          NULL,
        [DestSlot]       TINYINT      NULL,

        CONSTRAINT [PK_WebMarketListings] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [CK_WebMarketListings_Price]  CHECK ([Price] BETWEEN 10 AND 10000),
        CONSTRAINT [CK_WebMarketListings_Status] CHECK ([Status] IN ('active', 'sold', 'returned')),
        CONSTRAINT [CK_WebMarketListings_Slot]   CHECK ([SourceSlot] < 120 AND ([DestSlot] IS NULL OR [DestSlot] < 120))
    );

    -- Busca: anúncios ativos por categoria e preço.
    CREATE INDEX [IX_WebMarketListings_Search]
        ON [dbo].[WebMarketListings] ([Status], [Category], [Price]);

    -- "Meus anúncios" e o limite de 10 por conta.
    CREATE INDEX [IX_WebMarketListings_Seller]
        ON [dbo].[WebMarketListings] ([SellerAccount], [Status]);

    -- Histórico de compras. (Sem índice filtrado de propósito: filtrado exige
    -- SET options específicas em toda sessão que escreve na tabela.)
    CREATE INDEX [IX_WebMarketListings_Buyer]
        ON [dbo].[WebMarketListings] ([BuyerAccount], [ClosedAt]);

    -- Tela de admin: serial anunciado mais de uma vez.
    CREATE INDEX [IX_WebMarketListings_Serial]
        ON [dbo].[WebMarketListings] ([ItemSerial]);
END
GO

-- ============================================================
-- 2. Função auxiliar: o baú mudou só no slot indicado?
--    @kind 'remove': antes o slot tinha @item, depois está vazio (FF).
--    @kind 'insert': antes o slot estava livre, depois tem @item.
--    @before NULL = baú nunca usado (tratado como todo vazio).
-- ============================================================
IF OBJECT_ID(N'dbo.WebMarket_SlotChangeOk', N'FN') IS NULL
    EXEC (N'CREATE FUNCTION [dbo].[WebMarket_SlotChangeOk] () RETURNS BIT AS BEGIN RETURN 0 END');
GO

ALTER FUNCTION [dbo].[WebMarket_SlotChangeOk] (
    @before VARBINARY(1920),
    @after  VARBINARY(1920),
    @slot   INT,
    @item   BINARY(16),
    @kind   VARCHAR(6)
)
RETURNS BIT
AS
BEGIN
    DECLARE @empty16 BINARY(16) = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
    DECLARE @off INT = @slot * 16;

    IF @slot IS NULL OR @slot < 0 OR @slot > 119 RETURN 0;
    IF @after IS NULL OR DATALENGTH(@after) <> 1920 RETURN 0;
    IF @before IS NULL
        SET @before = CAST(REPLICATE(CAST(@empty16 AS VARBINARY(MAX)), 120) AS VARBINARY(1920));
    IF DATALENGTH(@before) <> 1920 RETURN 0;

    -- Fora do slot, tudo igual.
    IF SUBSTRING(@before, 1, @off) <> SUBSTRING(@after, 1, @off) RETURN 0;
    IF SUBSTRING(@before, @off + 17, 1920) <> SUBSTRING(@after, @off + 17, 1920) RETURN 0;

    IF @kind = 'remove'
    BEGIN
        IF SUBSTRING(@before, @off + 1, 16) <> @item    RETURN 0;
        IF SUBSTRING(@after,  @off + 1, 16) <> @empty16 RETURN 0;
        RETURN 1;
    END

    IF @kind = 'insert'
    BEGIN
        IF SUBSTRING(@before, @off + 1, 1) <> 0xFF   RETURN 0; -- slot livre
        IF SUBSTRING(@after,  @off + 1, 16) <> @item RETURN 0;
        RETURN 1;
    END

    RETURN 0;
END
GO

-- ============================================================
-- 3. Procedures
-- ============================================================

-- 3.1 Anunciar: tira o item do baú e cria o anúncio.
IF OBJECT_ID(N'dbo.WebMarket_Create', N'P') IS NULL
    EXEC (N'CREATE PROCEDURE [dbo].[WebMarket_Create] AS RETURN 0;');
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

    IF @price IS NULL OR @price < 10 OR @price > 10000
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

-- 3.2 Comprar: debita o comprador, põe o item no baú escolhido, credita o vendedor.
IF OBJECT_ID(N'dbo.WebMarket_Buy', N'P') IS NULL
    EXEC (N'CREATE PROCEDURE [dbo].[WebMarket_Buy] AS RETURN 0;');
GO

ALTER PROCEDURE [dbo].[WebMarket_Buy]
    @listingId BIGINT,
    @buyer     VARCHAR(10),
    @vaultId   INT,
    @stored    BIT,
    @slot      INT,
    @oldItems  VARBINARY(1920),
    @newItems  VARBINARY(1920)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET LOCK_TIMEOUT 3000;
    SET DEADLOCK_PRIORITY LOW;

    DECLARE @graceSeconds INT = 120;
    DECLARE @rows INT, @seller VARCHAR(10), @price INT, @status VARCHAR(10),
            @expires DATETIME2, @item BINARY(16), @net INT, @buyerName VARCHAR(10);

    IF EXISTS (SELECT 1 FROM MEMB_STAT WHERE memb___id = @buyer
               AND (ConnectStat <> 0 OR DisConnectTM > DATEADD(SECOND, -@graceSeconds, GETDATE())))
    BEGIN SELECT 1 AS Result; RETURN; END

    BEGIN TRAN;

    -- Trava só esta linha do mercado (seek na PK) até o COMMIT.
    SELECT @seller = SellerAccount, @price = Price, @status = Status,
           @expires = ExpiresAt, @item = ItemBytes
    FROM dbo.WebMarketListings WITH (UPDLOCK, ROWLOCK)
    WHERE Id = @listingId;

    IF @status IS NULL OR @status <> 'active' OR @expires <= SYSUTCDATETIME()
    BEGIN ROLLBACK; SELECT 5 AS Result; RETURN; END

    IF @seller COLLATE Latin1_General_CS_AS = @buyer
    BEGIN ROLLBACK; SELECT 8 AS Result; RETURN; END

    IF dbo.WebMarket_SlotChangeOk(@oldItems, @newItems, @slot, @item, 'insert') = 0
    BEGIN ROLLBACK; SELECT 7 AS Result; RETURN; END

    -- Preço vem da linha do mercado, nunca da API.
    UPDATE MEMB_INFO SET Cash = Cash - @price
    WHERE memb___id = @buyer AND Cash >= @price;
    IF @@ROWCOUNT <> 1
    BEGIN ROLLBACK; SELECT 6 AS Result; RETURN; END

    IF @stored = 0
        UPDATE warehouse SET Items = @newItems
        WHERE AccountID = @buyer AND VaultID = @vaultId
          AND ((@oldItems IS NULL AND Items IS NULL) OR (Items = @oldItems AND DATALENGTH(Items) = DATALENGTH(@oldItems)));
    ELSE
        UPDATE Extwarehouse SET Items = @newItems
        WHERE AccountID = @buyer AND VaultID = @vaultId
          AND AccountID COLLATE Latin1_General_CS_AS = @buyer -- ver nota de collation
          AND ((@oldItems IS NULL AND Items IS NULL) OR (Items = @oldItems AND DATALENGTH(Items) = DATALENGTH(@oldItems)));
    SET @rows = @@ROWCOUNT;

    IF @rows <> 1
    BEGIN ROLLBACK; SELECT CASE WHEN @rows > 1 THEN 2 ELSE 3 END AS Result; RETURN; END

    -- 10% de taxa: o vendedor recebe floor(preço * 0,9).
    SET @net = (@price * 9) / 10;

    -- Gold do vendedor: só Cash (o jogo não grava Cash), então vale mesmo
    -- com o vendedor online.
    UPDATE MEMB_INFO SET Cash = ISNULL(Cash, 0) + @net WHERE memb___id = @seller;

    SELECT @buyerName = memb_name FROM MEMB_INFO WHERE memb___id = @buyer;

    UPDATE dbo.WebMarketListings
    SET Status = 'sold', ClosedAt = SYSUTCDATETIME(),
        BuyerAccount = @buyer, BuyerName = @buyerName,
        SellerReceived = @net, Fee = @price - @net,
        DestVault = @vaultId, DestStored = @stored, DestSlot = @slot
    WHERE Id = @listingId;

    COMMIT;
    SELECT 0 AS Result, @price AS Price, @net AS SellerReceived;
END
GO

-- 3.3 Retirar: cancela (ativo) ou resgata (expirado) e devolve o item ao baú escolhido.
IF OBJECT_ID(N'dbo.WebMarket_Return', N'P') IS NULL
    EXEC (N'CREATE PROCEDURE [dbo].[WebMarket_Return] AS RETURN 0;');
GO

ALTER PROCEDURE [dbo].[WebMarket_Return]
    @listingId BIGINT,
    @account   VARCHAR(10),
    @vaultId   INT,
    @stored    BIT,
    @slot      INT,
    @oldItems  VARBINARY(1920),
    @newItems  VARBINARY(1920)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET LOCK_TIMEOUT 3000;
    SET DEADLOCK_PRIORITY LOW;

    DECLARE @graceSeconds INT = 120;
    DECLARE @rows INT, @seller VARCHAR(10), @status VARCHAR(10), @item BINARY(16);

    IF EXISTS (SELECT 1 FROM MEMB_STAT WHERE memb___id = @account
               AND (ConnectStat <> 0 OR DisConnectTM > DATEADD(SECOND, -@graceSeconds, GETDATE())))
    BEGIN SELECT 1 AS Result; RETURN; END

    BEGIN TRAN;

    SELECT @seller = SellerAccount, @status = Status, @item = ItemBytes
    FROM dbo.WebMarketListings WITH (UPDLOCK, ROWLOCK)
    WHERE Id = @listingId;

    IF @status IS NULL OR @status <> 'active' OR @seller COLLATE Latin1_General_CS_AS <> @account
    BEGIN ROLLBACK; SELECT 5 AS Result; RETURN; END

    IF dbo.WebMarket_SlotChangeOk(@oldItems, @newItems, @slot, @item, 'insert') = 0
    BEGIN ROLLBACK; SELECT 7 AS Result; RETURN; END

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

    UPDATE dbo.WebMarketListings
    SET Status = 'returned', ClosedAt = SYSUTCDATETIME(),
        DestVault = @vaultId, DestStored = @stored, DestSlot = @slot
    WHERE Id = @listingId;

    COMMIT;
    SELECT 0 AS Result;
END
GO

-- 3.4 Renovar: anúncio expirado volta a valer por mais 7 dias (não toca no baú).
IF OBJECT_ID(N'dbo.WebMarket_Renew', N'P') IS NULL
    EXEC (N'CREATE PROCEDURE [dbo].[WebMarket_Renew] AS RETURN 0;');
GO

ALTER PROCEDURE [dbo].[WebMarket_Renew]
    @listingId BIGINT,
    @account   VARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;
    SET LOCK_TIMEOUT 3000;
    SET DEADLOCK_PRIORITY LOW;

    UPDATE dbo.WebMarketListings
    SET ExpiresAt = DATEADD(DAY, 7, SYSUTCDATETIME())
    WHERE Id = @listingId AND SellerAccount = @account
      AND Status = 'active' AND ExpiresAt <= SYSUTCDATETIME();

    SELECT CASE WHEN @@ROWCOUNT = 1 THEN 0 ELSE 5 END AS Result;
END
GO

-- ============================================================
-- 4. Permissões do login da API (ver migration 0009 / docs/DB_API_USER.md)
-- ============================================================
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'mu_api')
BEGIN
    GRANT SELECT ON [dbo].[WebMarketListings] TO [mu_api];
    GRANT EXECUTE ON [dbo].[WebMarket_Create] TO [mu_api];
    GRANT EXECUTE ON [dbo].[WebMarket_Buy]    TO [mu_api];
    GRANT EXECUTE ON [dbo].[WebMarket_Return] TO [mu_api];
    GRANT EXECUTE ON [dbo].[WebMarket_Renew]  TO [mu_api];
    -- Ler os baús guardados (lista de baús e cálculo do baú novo). Só leitura.
    GRANT SELECT ON [dbo].[Extwarehouse] ([AccountID], [VaultID], [Items]) TO [mu_api];
END
GO

-- Conferência: deve listar a tabela, a função e as 4 procedures.
SELECT name, type_desc FROM sys.objects
WHERE name IN (N'WebMarketListings', N'WebMarket_SlotChangeOk', N'WebMarket_Create',
               N'WebMarket_Buy', N'WebMarket_Return', N'WebMarket_Renew')
ORDER BY name;
GO
