-- Pré-checagem da migration 0016 (mercado). SÓ LEITURA: não altera nada.
--
-- Rode no banco MuOnline e cole o resultado de cada bloco. A 0016 parte
-- destas premissas; se alguma não bater, a 0016 precisa de ajuste antes:
--
--   1. Índices de warehouse, Extwarehouse, MEMB_INFO e MEMB_STAT.
--      Esperado: MEMB_INFO e MEMB_STAT com índice em memb___id;
--      Extwarehouse com UX_Extwarehouse_Account_Vault; warehouse sem índice
--      (já documentado em docs/WAREHOUSE_BYTE_FORMAT.md).
--   2. Colunas e tipos usados pelas procedures (Items varbinary(1920),
--      VaultID int, Cash int, ConnectStat, DisConnectTM datetime).
--   3. Triggers nessas tabelas (um trigger rodaria dentro da transação do
--      mercado; precisamos saber se existe).
--   4. Tamanho das tabelas (define se um índice novo em warehouse é instantâneo).
--   5. Contas com mais de uma linha em warehouse (a 0016 recusa mexer nelas).
--   6. Isolamento do banco (READ_COMMITTED_SNAPSHOT) e compatibility level.

USE [MuOnline]
GO

-- 1. Índices
SELECT OBJECT_NAME(i.object_id) AS tabela, i.name AS indice, i.type_desc, i.is_unique, i.is_primary_key,
       STUFF((SELECT ',' + c.name FROM sys.index_columns ic
              JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
              ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 1, '') AS colunas
FROM sys.indexes i
WHERE i.object_id IN (OBJECT_ID(N'dbo.warehouse'), OBJECT_ID(N'dbo.Extwarehouse'),
                      OBJECT_ID(N'dbo.MEMB_INFO'), OBJECT_ID(N'dbo.MEMB_STAT'))
ORDER BY tabela, i.index_id;

-- 2. Colunas
SELECT OBJECT_NAME(c.object_id) AS tabela, c.name AS coluna, t.name AS tipo, c.max_length, c.is_nullable, c.collation_name
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id IN (OBJECT_ID(N'dbo.warehouse'), OBJECT_ID(N'dbo.Extwarehouse'), OBJECT_ID(N'dbo.MEMB_STAT'))
   OR (c.object_id = OBJECT_ID(N'dbo.MEMB_INFO') AND c.name IN (N'memb___id', N'memb_name', N'Cash'))
ORDER BY tabela, c.column_id;

-- 3. Triggers
SELECT OBJECT_NAME(parent_id) AS tabela, name AS trigger_name, is_disabled
FROM sys.triggers
WHERE parent_id IN (OBJECT_ID(N'dbo.warehouse'), OBJECT_ID(N'dbo.Extwarehouse'),
                    OBJECT_ID(N'dbo.MEMB_INFO'), OBJECT_ID(N'dbo.MEMB_STAT'));

-- 4. Tamanho
SELECT 'warehouse' AS tabela, COUNT(*) AS linhas FROM warehouse WITH (NOLOCK)
UNION ALL SELECT 'Extwarehouse', COUNT(*) FROM Extwarehouse WITH (NOLOCK)
UNION ALL SELECT 'MEMB_INFO', COUNT(*) FROM MEMB_INFO WITH (NOLOCK);

-- 5. Contas com mais de uma linha no baú ativo
SELECT AccountID, COUNT(*) AS linhas FROM warehouse WITH (NOLOCK)
GROUP BY AccountID HAVING COUNT(*) > 1;

-- 6. Isolamento e compatibilidade
SELECT name, is_read_committed_snapshot_on, snapshot_isolation_state_desc, compatibility_level
FROM sys.databases WHERE name = DB_NAME();

-- Exemplo de MEMB_STAT (confere o formato de DisConnectTM vs. hora do servidor)
SELECT TOP 3 memb___id, ConnectStat, ConnectTM, DisConnectTM, GETDATE() AS agora
FROM MEMB_STAT WITH (NOLOCK) ORDER BY DisConnectTM DESC;
GO
