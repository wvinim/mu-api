# Seção 4 — Personagens — concluída

## O que foi feito

- `GET /api/v1/characters/:name` — perfil público de um personagem
  (qualquer um pode consultar, sem autenticação). Retorna nível, classe
  (código cru, ver nota abaixo), resets, stats, PK, leadership, datas de
  criação/último acesso. **Nunca retorna** `Money`, posição no mapa
  (`MapNumber`/`MapPosX`/`MapPosY`/`MapDir`) nem o `AccountID` — decisão
  de privacidade/segurança (evitar expor localização em tempo real de
  jogadores ou ligar personagem a username de conta publicamente).
- `GET /api/v1/characters/ranking` — paginado (`page`, `limit` até 100),
  com filtro opcional `classCode`, interpretado como **raça inteira**
  (`Class` na faixa `[classCode & 0xF0, +16)`, ex: 0 = DW/SM/GrM —
  corrigido 2026-09-28, antes era igualdade exata). Busca por nome de personagem foi
  removida (decisão do usuário, 2026-09-20).
  Ordenado por `Resets DESC, cLevel DESC`. **Cacheado em memória**
  (`RANKING_CACHE_TTL_SECONDS`, padrão 180s) por página/limit/raça
  — evita bater no banco a cada request, conforme pedido no brief.
  Paginação via `ROW_NUMBER()` (não `OFFSET/FETCH` — ver
  `docs/DB_NOTES.md`, o banco não suporta essa sintaxe).
- Testes Jest + Supertest (`tests/characters.test.js`), banco mockado,
  incluindo um teste que confirma o cache (segunda chamada com os mesmos
  parâmetros não bate no repositório).

## Decisões tomadas

- **`GET /characters/:name/inventory` não foi implementada** — você
  confirmou que o site não precisa mostrar inventário. Removida do
  escopo desta sessão.
- **`Class` continua cru** (`classCode`), mesma decisão/limitação da
  Seção 3 — não adivinhei a fórmula de decodificação de classe/evolução.

## Removido do escopo por decisão sua

`GET /api/v1/characters/ranking/guild` — removido do escopo, a seu
pedido. O schema passado não tem tabela de guild.

## Pendências / passos manuais seus

- Rodar `npm test` para conferir a nova suíte.
- ~~Adendo (2026-09-17): índice de apoio pro ranking~~ — **aplicado**.
  `Character` só tinha índice em `[Name]` (a PK); `ORDER BY Resets DESC,
  cLevel DESC` do ranking virava table scan + sort completo. Corrigido
  com `migrations/0008_character_ranking_index.sql` (índice não-clustered
  aditivo, sem afetar login) — **aplicada em produção** pelo usuário.

## Próxima seção

Seguindo a ordem do brief, a próxima é a Seção 5 (Loja/Créditos — Efí),
que tem perguntas obrigatórias (credenciais de sandbox, link da
documentação da Efí) antes de eu poder codar qualquer coisa.

## Adendo (2026-10-24): esconder personagem do ranking

- Coluna nova `Character.HideFromRanking` (BIT NOT NULL, padrão 0) em
  `migrations/0013_character_hide_from_ranking.sql`. O ranking e o `total`
  filtram `HideFromRanking = 0`.
- O valor é alterado manualmente no banco (`UPDATE ... SET HideFromRanking = 1
  WHERE Name = '...'`). Não há rota de admin para isso.
- **Passo manual seu:** rodar a checagem comentada no fim da migration,
  aplicar a migration **antes** do deploy desta mudança (sem a coluna, o
  ranking dá erro de SQL) e avisar quando aplicou.

## Adendo (2026-11-26): ranking por período, top 10

Com o limite de 200 resets e a troca de 100 resets no Time Collector, o
ranking por `Resets` deixou de medir progresso. Agora:

- `?period=total|month|week|day` (+ `previous=true` para o período
  anterior). Sempre top 10.
- **Total** = `Character.ResetsMonth` (nunca zerada desde o wipe, não diminui
  no Time Collector = total histórico). Índice `IX_Character_RankingTotal`.
- **Dia/semana/mês** = `SUM(Qtd)` da `dbo.ResetDiario` (1 linha por
  personagem por dia), gravada pelo trigger `TR_Character_ResetDiario` em
  `Character` (script `sql/2026-11-26_reset_diario.sql` do repositório do
  GameServer). O trigger só conta `Resets` subindo exatamente +1.
- As datas do período são calculadas no SQL (`GETDATE()` = horário de
  Brasília na VPS). Não calcular em JS: o driver trabalha em UTC.
- Consultas com `WITH (NOLOCK)`: ranking nunca bloqueia o gameserver.
- Cache: 180s no período atual, 1h no anterior
  (`RANKING_PREVIOUS_CACHE_TTL_SECONDS`); a chave inclui o dia de Brasília,
  então a virada do dia não deixa "hoje" preso no dia anterior.
- **Ordem de deploy:** script do GameServer → `migrations/0019_ranking_periodo.sql`
  (GRANT + índice) → API → front. A API antiga continua funcionando com a
  tabela nova; a API nova sem a tabela dá erro só nos períodos.
- Limpeza futura (manter mês atual + 2 anteriores):
  `DELETE FROM dbo.ResetDiario WHERE Dia < DATEADD(month, DATEDIFF(month, 0, GETDATE()) - 2, 0)`.
