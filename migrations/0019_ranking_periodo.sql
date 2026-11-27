-- Migration 0019 — ranking por período (dia / semana / mês) + total histórico,
-- NÃO aplicada automaticamente.
--
-- PRÉ-REQUISITO: a tabela dbo.ResetDiario e o trigger
-- TR_Character_ResetDiario, criados pelo script do repositório do
-- GameServer: sql/2026-11-26_reset_diario.sql. Rode aquele primeiro.
--
-- 1. GRANT SELECT em ResetDiario para o mu_api (só leitura; quem escreve é o
--    trigger em Character).
-- 2. Índice do ranking "Total": ResetsMonth nunca é zerada desde o wipe (a troca
--    no Time Collector soma 1, como um reset), então é o total histórico de resets. Custo
--    nas escritas de Character: ResetsMonth só muda num reset.
--
-- Os rankings de dia/semana/mês leem só o trecho de datas do índice
-- clusterizado PK_ResetDiario (Dia, Name), não precisam de índice extra.
--
-- Opcional, depois que a API nova estiver no ar: IX_Character_Ranking
-- (migration 0008, Resets DESC) não é mais usado pelo ranking. Pode sair com
--   DROP INDEX [IX_Character_Ranking] ON [dbo].[Character];
--
-- Idempotente: pode rodar de novo sem efeito.

IF OBJECT_ID(N'dbo.ResetDiario', N'U') IS NULL
BEGIN
    RAISERROR('dbo.ResetDiario nao existe: rode antes sql/2026-11-26_reset_diario.sql do GameServer.', 16, 1);
    RETURN;
END
GO

GRANT SELECT ON [dbo].[ResetDiario] TO [mu_api];
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.Character') AND name = N'IX_Character_RankingTotal'
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Character_RankingTotal]
        ON [dbo].[Character] ([ResetsMonth] DESC, [cLevel] DESC);
END
GO
