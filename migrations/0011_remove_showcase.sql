-- Migration 0011 — remoção do mercado (vitrine do baú /mercado), NÃO aplicada
-- automaticamente. Desfaz a migration 0010.
--
-- O comando /mercado saiu do GameServer. Sem ele, o baú 200 não é mais
-- alcançável (o /bau só aceita números até o limite do VIP), então antes de
-- apagar as estruturas este script RENUMERA os baús 200 que existirem:
--
--   * baú 200 ATIVO (warehouse.VaultID = 200)       -> primeiro número livre da conta
--   * baú 200 GUARDADO (Extwarehouse.VaultID = 200) -> primeiro número livre da conta
--
-- "Livre" = não usado pela conta nem em Extwarehouse nem como baú ativo,
-- começando do 0. O jogador recupera os itens com /bau N. A consulta final
-- lista cada conta renumerada e marca quem ficou com N acima do limite do
-- VIP (Free 2, VIP 3, Super VIP 6, Mega VIP 8 — FT/Comandos.txt): essas
-- contas precisam de ajuste manual (ex.: liberar um número menor).
--
-- Rode de preferência com o servidor em manutenção. Idempotente: rodar de
-- novo sem baús 200 só não renumera nada.
--
-- Mantém: índice único UX_Extwarehouse_Account_Vault e a MUDAR_BAU nova
-- (valem para o /bau).

USE [MuOnline]
GO

-- ============================================================
-- 1. Renumerar baús 200
-- ============================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @renumerados TABLE (
    AccountID   VARCHAR(10),
    Origem      VARCHAR(10),
    NovoVaultID INT
);

BEGIN TRAN;

DECLARE @acc VARCHAR(10), @novo INT;

DECLARE contas CURSOR LOCAL FAST_FORWARD FOR
    SELECT DISTINCT RTRIM(AccountID) FROM (
        SELECT AccountID FROM warehouse    WITH (UPDLOCK, HOLDLOCK) WHERE VaultID = 200
        UNION
        SELECT AccountID FROM Extwarehouse WITH (UPDLOCK, HOLDLOCK) WHERE VaultID = 200
    ) t;

OPEN contas;
FETCH NEXT FROM contas INTO @acc;

WHILE @@FETCH_STATUS = 0
BEGIN
    -- baú 200 ativo
    IF EXISTS (SELECT 1 FROM warehouse WHERE AccountID = @acc AND VaultID = 200)
    BEGIN
        SELECT @novo = MIN(n.n)
        FROM (SELECT TOP 255 ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n FROM sys.all_objects) n
        WHERE n.n NOT IN (SELECT VaultID FROM Extwarehouse WHERE AccountID = @acc AND VaultID IS NOT NULL)
          AND n.n NOT IN (SELECT VaultID FROM warehouse WHERE AccountID = @acc);

        UPDATE warehouse SET VaultID = @novo WHERE AccountID = @acc AND VaultID = 200;
        INSERT INTO @renumerados VALUES (@acc, 'ativo', @novo);
    END

    -- baú 200 guardado
    IF EXISTS (SELECT 1 FROM Extwarehouse WHERE AccountID = @acc AND VaultID = 200)
    BEGIN
        SELECT @novo = MIN(n.n)
        FROM (SELECT TOP 255 ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n FROM sys.all_objects) n
        WHERE n.n NOT IN (SELECT VaultID FROM Extwarehouse WHERE AccountID = @acc AND VaultID IS NOT NULL)
          AND n.n NOT IN (SELECT VaultID FROM warehouse WHERE AccountID = @acc);

        UPDATE Extwarehouse SET VaultID = @novo WHERE AccountID = @acc AND VaultID = 200;
        INSERT INTO @renumerados VALUES (@acc, 'guardado', @novo);
    END

    FETCH NEXT FROM contas INTO @acc;
END

CLOSE contas;
DEALLOCATE contas;

COMMIT;

-- Relatório: quem foi renumerado e quem ficou fora do limite do VIP.
SELECT
    r.AccountID,
    r.Origem,
    r.NovoVaultID,
    ISNULL(m.Vip, 0) AS Vip,
    CASE ISNULL(m.Vip, 0) WHEN 1 THEN 3 WHEN 2 THEN 6 WHEN 3 THEN 8 ELSE 2 END AS LimiteDoVip,
    CASE WHEN r.NovoVaultID > CASE ISNULL(m.Vip, 0) WHEN 1 THEN 3 WHEN 2 THEN 6 WHEN 3 THEN 8 ELSE 2 END
         THEN 'FORA DO LIMITE - ajuste manual' ELSE 'ok (/bau ' + CAST(r.NovoVaultID AS VARCHAR(5)) + ')' END AS Situacao
FROM @renumerados r
LEFT JOIN MEMB_INFO m ON m.memb___id = r.AccountID
ORDER BY r.AccountID;
GO

-- ============================================================
-- 2. Remover as estruturas do mercado (migration 0010)
-- ============================================================
IF OBJECT_ID(N'dbo.MERCADO_CONTATO', N'P') IS NOT NULL
    DROP PROCEDURE [dbo].[MERCADO_CONTATO];
GO

IF OBJECT_ID(N'dbo.WebShowcaseContact', N'U') IS NOT NULL
    DROP TABLE [dbo].[WebShowcaseContact];
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'mu_api')
    REVOKE SELECT ON [dbo].[Extwarehouse] ([AccountID], [VaultID], [Items], [EndUseDate]) FROM [mu_api];
GO

-- Conferência: deve voltar 0 em tudo.
SELECT
    (SELECT COUNT(*) FROM warehouse    WHERE VaultID = 200) AS bau200_ativo,
    (SELECT COUNT(*) FROM Extwarehouse WHERE VaultID = 200) AS bau200_guardado,
    CASE WHEN OBJECT_ID(N'dbo.WebShowcaseContact') IS NULL THEN 0 ELSE 1 END AS tabela_contato,
    CASE WHEN OBJECT_ID(N'dbo.MERCADO_CONTATO') IS NULL THEN 0 ELSE 1 END AS procedure_contato;
GO
