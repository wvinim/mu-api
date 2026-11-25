-- ============================================================
-- 0017 — Limpa o histórico de teste do mercado antes da liberação
-- ============================================================
-- Rode 0017_market_reset_preview.sql antes e confira o resultado.
--
-- O que faz:
--   - Apaga os anúncios encerrados (sold / returned) de WebMarketListings.
--   - Se a tabela ficar vazia, reinicia o Id (o próximo anúncio será 1).
--
-- O que NÃO faz:
--   - Não toca em anúncio ativo/expirado: o item só existe nessa linha. Se houver
--     algum, o script para sem apagar nada; retire-os pelo site antes.
--   - Não devolve gold das vendas de teste (MEMB_INFO.Cash) nem mexe em baús.
--   - Não apaga o log de auditoria (WebAuditLog).
--
-- Só mexe em WebMarketListings, tabela que o gameserver não usa: não trava o jogo.
-- Rode com um usuário dono do banco (mu_api só tem SELECT nesta tabela).

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 3000;

DECLARE @active INT, @deleted INT, @remaining INT;

BEGIN TRAN;

-- UPDLOCK/HOLDLOCK: ninguém anuncia ou retira entre a checagem e o DELETE.
SELECT @active = COUNT(*)
FROM dbo.WebMarketListings WITH (UPDLOCK, HOLDLOCK)
WHERE Status = 'active';

IF @active > 0
BEGIN
    ROLLBACK;
    RAISERROR('Existem %d anuncio(s) ativo(s) ou expirado(s). Retire-os pelo site antes. Nada foi apagado.', 16, 1, @active);
END
ELSE
BEGIN
    DELETE FROM dbo.WebMarketListings WHERE Status IN ('sold', 'returned');
    SET @deleted = @@ROWCOUNT;

    SELECT @remaining = COUNT(*) FROM dbo.WebMarketListings;
    IF @remaining = 0
        DBCC CHECKIDENT ('dbo.WebMarketListings', RESEED, 0) WITH NO_INFOMSGS;

    COMMIT;

    SELECT @deleted AS AnunciosApagados, @remaining AS LinhasRestantes,
           CASE WHEN @remaining = 0 THEN 'Id reiniciado: próximo anúncio = 1' ELSE 'Id mantido' END AS Identidade;
END
