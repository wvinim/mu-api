-- Migration 0013 — coluna para esconder personagens do ranking
-- (GET /characters/ranking), NÃO aplicada automaticamente.
--
-- Adiciona `Character.HideFromRanking` (BIT NOT NULL, padrão 0). Com 1, o
-- personagem some do ranking e da contagem `total` (ex: personagens da
-- staff/GM). O valor é alterado manualmente no banco; a API só lê.
--
-- A coluna é só ADITIVA, entra no fim da tabela e tem DEFAULT. Um INSERT
-- do gameserver com lista de colunas explícita (o normal, ex:
-- WZ_CreateCharacter) continua funcionando sem saber dela. Só um
-- `INSERT INTO Character VALUES (...)` sem lista de colunas quebraria.
-- Antes de aplicar, confira que nenhuma procedure faz isso (consulta
-- no fim deste arquivo, comentada).
--
-- SQL Server 2008 R2: ADD ... NOT NULL DEFAULT reescreve todas as linhas
-- e trava a tabela durante a operação. Com poucos personagens é instantâneo,
-- mas aplique num momento de pouco movimento.
--
-- Permissão: o mu_api tem GRANT SELECT na tabela inteira (migration 0009),
-- então já enxerga a coluna nova. Não precisa de GRANT.
--
-- Idempotente: pode rodar de novo sem efeito.

IF COL_LENGTH(N'dbo.Character', N'HideFromRanking') IS NULL
BEGIN
    ALTER TABLE [dbo].[Character]
        ADD [HideFromRanking] BIT NOT NULL
            CONSTRAINT [DF_Character_HideFromRanking] DEFAULT (0);
END
GO

-- Como esconder / mostrar um personagem:
--   UPDATE dbo.Character SET HideFromRanking = 1 WHERE Name = 'NomeDoChar';
--   UPDATE dbo.Character SET HideFromRanking = 0 WHERE Name = 'NomeDoChar';
-- (o ranking tem cache de ~180s, então leva até 3 min para refletir)

-- Checagem antes de aplicar: lista os objetos que fazem INSERT em Character.
-- Abra cada um e confirme que o INSERT tem lista de colunas.
--   SELECT OBJECT_NAME(object_id) AS objeto
--   FROM sys.sql_modules
--   WHERE definition LIKE '%INSERT%Character%';
