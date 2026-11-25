-- ============================================================
-- 0017 — Prévia da limpeza dos anúncios de teste do mercado (SÓ LEITURA)
-- ============================================================
-- Rode antes de 0017_market_reset.sql. Não altera nada.

-- 1) Resumo por status. "active" inclui os expirados não resgatados.
SELECT Status, COUNT(*) AS Anuncios, MIN(CreatedAt) AS Primeiro, MAX(CreatedAt) AS Ultimo
FROM dbo.WebMarketListings WITH (NOLOCK)
GROUP BY Status;

-- 2) Anúncios ATIVOS: o item está guardado só nesta tabela (saiu do baú).
--    Precisam ser retirados pelo site (Cancelar/Resgatar) ANTES da limpeza,
--    senão o item se perde. A limpeza recusa rodar se esta lista não estiver vazia.
SELECT Id, SellerAccount, ItemName, ItemLevel, ItemSerial, Price, CreatedAt, ExpiresAt,
       CASE WHEN ExpiresAt <= SYSUTCDATETIME() THEN 'expirado' ELSE 'ativo' END AS Estado
FROM dbo.WebMarketListings WITH (NOLOCK)
WHERE Status = 'active'
ORDER BY Id;

-- 3) Gold que trocou de mãos nas vendas de teste. Apagar o histórico NÃO
--    devolve esse gold. Se quiser desfazer, ajuste MEMB_INFO.Cash à parte.
SELECT 'comprador pagou' AS Movimento, BuyerAccount AS Conta, COUNT(*) AS Vendas, SUM(Price) AS Gold
FROM dbo.WebMarketListings WITH (NOLOCK)
WHERE Status = 'sold'
GROUP BY BuyerAccount
UNION ALL
SELECT 'vendedor recebeu', SellerAccount, COUNT(*), SUM(SellerReceived)
FROM dbo.WebMarketListings WITH (NOLOCK)
WHERE Status = 'sold'
GROUP BY SellerAccount
ORDER BY Movimento, Conta;

-- 4) Contas que aparecem no mercado. Confira se são só as suas contas de teste.
SELECT Conta, COUNT(*) AS Linhas FROM (
    SELECT SellerAccount AS Conta FROM dbo.WebMarketListings WITH (NOLOCK)
    UNION ALL
    SELECT BuyerAccount FROM dbo.WebMarketListings WITH (NOLOCK) WHERE BuyerAccount IS NOT NULL
) c
GROUP BY Conta
ORDER BY Conta;

-- 5) Eventos market.* no log de auditoria (a limpeza NÃO apaga estes).
SELECT EventType, COUNT(*) AS Eventos
FROM dbo.WebAuditLog WITH (NOLOCK)
WHERE EventType LIKE 'market.%'
GROUP BY EventType
ORDER BY EventType;
