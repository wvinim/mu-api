-- Migration 0010 — mercado (vitrine do baú /mercado), NÃO aplicada automaticamente.
--
-- O jogador usa /mercado no jogo para trocar para o baú da vitrine
-- (VaultID 200, mesma procedure MUDAR_BAU do /bau). O site lê a vitrine
-- só quando ela está guardada em Extwarehouse (VaultID 200). Ver
-- docs/SECTION_10_MARKET.md.
--
-- Esta migration:
--   1. Cria WebShowcaseContact: personagem de contato da vitrine (o último
--      que usou /mercado na conta).
--   2. Cria a procedure MERCADO_CONTATO, chamada pelo GameServer no
--      /mercado. O GameServer roda com o login dele (não o mu_api), então
--      não precisa de GRANT EXECUTE para a API.
--   3. Dá à API (mu_api, migration 0009) leitura em WebShowcaseContact e
--      nas colunas de Extwarehouse que a vitrine usa. Só SELECT.
--
-- Mesma mecânica das anteriores: idempotente, COLLATE dinâmico nas FKs,
-- revise e aplique manualmente. Aplique ANTES de subir o GameServer com o
-- /mercado (sem a procedure, o /mercado troca de baú mas só registra no log
-- que não conseguiu gravar o contato).

-- ============================================================
-- 1. WebShowcaseContact
-- ============================================================
IF OBJECT_ID(N'dbo.WebShowcaseContact', N'U') IS NULL
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
    CREATE TABLE [dbo].[WebShowcaseContact] (
        [AccountId]     VARCHAR(10) COLLATE ' + @collationAccount + N' NOT NULL,
        [CharacterName] VARCHAR(10) COLLATE ' + @collationChar + N' NULL,
        [UpdatedAt]     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebShowcaseContact] PRIMARY KEY CLUSTERED ([AccountId] ASC),
        CONSTRAINT [FK_WebShowcaseContact_MEMB_INFO] FOREIGN KEY ([AccountId])
            REFERENCES [dbo].[MEMB_INFO] ([memb___id]),
        -- ON DELETE SET NULL: apagar o personagem no jogo não pode falhar
        -- (ver migration 0005 — FK sem ação derrubava o GameServer).
        CONSTRAINT [FK_WebShowcaseContact_Character] FOREIGN KEY ([CharacterName])
            REFERENCES [dbo].[Character] ([Name]) ON DELETE SET NULL
    );';
    EXEC sp_executesql @sql1;
END
GO

-- ============================================================
-- 2. MERCADO_CONTATO (chamada pelo GameServer)
-- ============================================================
IF OBJECT_ID(N'dbo.MERCADO_CONTATO', N'P') IS NULL
    EXEC (N'CREATE PROCEDURE [dbo].[MERCADO_CONTATO] AS RETURN 0;');
GO

ALTER PROCEDURE [dbo].[MERCADO_CONTATO]
    @login varchar(10),
    @name  varchar(10)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- só aceita personagem da própria conta
    IF NOT EXISTS (SELECT 1 FROM [Character] WHERE AccountID = @login AND Name = @name)
        RETURN 1;

    BEGIN TRAN;

    UPDATE [dbo].[WebShowcaseContact] WITH (UPDLOCK, HOLDLOCK)
    SET CharacterName = @name, UpdatedAt = SYSUTCDATETIME()
    WHERE AccountId = @login;

    IF @@ROWCOUNT = 0
        INSERT INTO [dbo].[WebShowcaseContact] (AccountId, CharacterName, UpdatedAt)
        VALUES (@login, @name, SYSUTCDATETIME());

    COMMIT;
    RETURN 0;
END
GO

-- ============================================================
-- 3. Permissões da API (só leitura)
-- ============================================================
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'mu_api')
BEGIN
    GRANT SELECT ON [dbo].[WebShowcaseContact] TO [mu_api];
    GRANT SELECT ON [dbo].[Extwarehouse] ([AccountID], [VaultID], [Items], [EndUseDate]) TO [mu_api];
END
GO
