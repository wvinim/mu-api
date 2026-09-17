-- Migration 0008 — índice de apoio pro ranking (GET /characters/ranking),
-- NÃO aplicada automaticamente.
--
-- Investigação (2026-09-17): `Character` só tem um índice hoje
-- (PK_Character, não-clustered, em [Name]) — nenhum índice em [Resets]/
-- [cLevel], usados no ORDER BY do ranking (charactersRepository.findRanking).
-- Com poucas linhas isso não importa (mesa de teste tinha 5 personagens),
-- mas o usuário estima ~150 jogadores simultâneos em produção (picos de
-- 200) — o total de personagens acumulados ao longo do tempo deve crescer
-- bem além disso, e sem índice o ORDER BY vira table scan + sort completo
-- a cada consulta (a consulta em si já é rara graças ao cache de TTL de
-- charactersController.js, mas cada execução fica cara conforme a tabela
-- cresce).
--
-- Trade-off ciente: `Character` é escrita o tempo todo pelo gameserver
-- (stats, posição, vida mudam constantemente pra cada personagem online).
-- Um índice novo tem custo pequeno em CADA escrita nessa tabela — não é
-- zero, mas é desprezível no volume esperado (~150-200 jogadores online
-- simultâneos). Índice é só ADITIVO: não altera nenhuma coluna nem
-- comportamento de leitura existente, não deveria afetar o login do
-- client.
--
-- Mesma mecânica das migrations anteriores: idempotente, revise e aplique
-- manualmente quando achar que o volume de personagens já justifica (sem
-- pressa — não é bloqueante pra nada).

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.Character') AND name = N'IX_Character_Ranking'
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Character_Ranking]
        ON [dbo].[Character] ([Resets] DESC, [cLevel] DESC);
END
GO
