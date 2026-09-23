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
  com filtro opcional `classCode`. Busca por nome de personagem foi
  removida (decisão do usuário, 2026-09-20).
  Ordenado por `Resets DESC, cLevel DESC`. **Cacheado em memória**
  (`RANKING_CACHE_TTL_SECONDS`, padrão 60s) por combinação de parâmetros
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
