-- Pós-checagem da migration 0016 (mercado). NÃO lê nem grava tabela nenhuma:
-- só chama a função WebMarket_SlotChangeOk com baús montados em memória.
--
-- Rode depois da 0016. Todas as linhas devem sair com ok = 'OK'.
-- Qualquer 'FALHOU' = não use o mercado e me mande o resultado.

USE [MuOnline]
GO

DECLARE @ff16  BINARY(16) = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
DECLARE @empty VARBINARY(1920) = CAST(REPLICATE(CAST(@ff16 AS VARBINARY(MAX)), 120) AS VARBINARY(1920));
DECLARE @item  BINARY(16) = 0x070F00A0123456780000000000000000; -- item fictício
DECLARE @other BINARY(16) = 0x0B1300A0876543210000000000000000; -- outro item fictício

-- baú vazio com @item no slot 5
DECLARE @with5 VARBINARY(1920) = SUBSTRING(@empty, 1, 80) + @item + SUBSTRING(@empty, 97, 1920);
-- baú com @item no slot 5 e @other no slot 0
DECLARE @with5and0 VARBINARY(1920) = @other + SUBSTRING(@with5, 17, 1920);
-- baú vazio com @other no slot 0 (= @with5and0 sem o item 5)
DECLARE @only0 VARBINARY(1920) = @other + SUBSTRING(@empty, 17, 1920);
-- slots das pontas
DECLARE @with0   VARBINARY(1920) = @item + SUBSTRING(@empty, 17, 1920);
DECLARE @with119 VARBINARY(1920) = SUBSTRING(@empty, 1, 1904) + @item;

SELECT teste, esperado, resultado, CASE WHEN esperado = resultado THEN 'OK' ELSE 'FALHOU' END AS ok
FROM (
              SELECT 'retirar item do slot 5'                    AS teste, 1 AS esperado, dbo.WebMarket_SlotChangeOk(@with5, @empty, 5, @item, 'remove') AS resultado
    UNION ALL SELECT 'retirar mantendo outro item',                       1, dbo.WebMarket_SlotChangeOk(@with5and0, @only0, 5, @item, 'remove')
    UNION ALL SELECT 'retirar apontando slot errado',                     0, dbo.WebMarket_SlotChangeOk(@with5, @empty, 6, @item, 'remove')
    UNION ALL SELECT 'retirar item que não está lá',                      0, dbo.WebMarket_SlotChangeOk(@with5, @empty, 5, @other, 'remove')
    UNION ALL SELECT 'retirar apagando outro item junto',                 0, dbo.WebMarket_SlotChangeOk(@with5and0, @empty, 5, @item, 'remove')
    UNION ALL SELECT 'colocar item no slot 5',                            1, dbo.WebMarket_SlotChangeOk(@empty, @with5, 5, @item, 'insert')
    UNION ALL SELECT 'colocar em baú NULL (nunca usado)',                 1, dbo.WebMarket_SlotChangeOk(NULL, @with5, 5, @item, 'insert')
    UNION ALL SELECT 'colocar em slot ocupado',                           0, dbo.WebMarket_SlotChangeOk(@with5, @with5, 5, @item, 'insert')
    UNION ALL SELECT 'colocar item diferente do anúncio',                 0, dbo.WebMarket_SlotChangeOk(@empty, @with5, 5, @other, 'insert')
    UNION ALL SELECT 'colocar e mexer em outro slot',                     0, dbo.WebMarket_SlotChangeOk(@empty, @with5and0, 5, @item, 'insert')
    UNION ALL SELECT 'colocar no slot 0 (ponta)',                         1, dbo.WebMarket_SlotChangeOk(@empty, @with0, 0, @item, 'insert')
    UNION ALL SELECT 'colocar no slot 119 (ponta)',                       1, dbo.WebMarket_SlotChangeOk(@empty, @with119, 119, @item, 'insert')
    UNION ALL SELECT 'slot fora do baú (120)',                            0, dbo.WebMarket_SlotChangeOk(@empty, @with119, 120, @item, 'insert')
    UNION ALL SELECT 'baú novo com tamanho errado',                       0, dbo.WebMarket_SlotChangeOk(@empty, SUBSTRING(@with5, 1, 1904), 5, @item, 'insert')
) t;

-- Permissões dadas ao mu_api (deve listar SELECT na tabela, EXECUTE nas 4
-- procedures e SELECT nas 3 colunas de Extwarehouse).
SELECT OBJECT_NAME(p.major_id) AS objeto, COL_NAME(p.major_id, p.minor_id) AS coluna,
       p.permission_name, p.state_desc
FROM sys.database_permissions p
WHERE p.grantee_principal_id = USER_ID(N'mu_api')
  AND OBJECT_NAME(p.major_id) IN (N'WebMarketListings', N'WebMarket_Create', N'WebMarket_Buy',
                                  N'WebMarket_Return', N'WebMarket_Renew', N'Extwarehouse')
ORDER BY objeto, coluna;
GO
