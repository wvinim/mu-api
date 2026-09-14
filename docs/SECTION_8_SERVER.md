# Seção 8 — Status do servidor — concluída, não testada contra o banco real

## O que foi feito

- `GET /api/v1/server/status` — `{ status: "online", playersOnline: N }`.
  Cacheado em memória (`SERVER_STATUS_CACHE_TTL_SECONDS`, padrão 15s —
  curto, conforme pedido no brief). `playersOnline` conta as contas com
  `MEMB_STAT.ConnectStat = 1`.
- `GET /api/v1/server/info` — metadados estáticos (`name`, `season`,
  `expRate`, `dropRate`, `maxResets`, `websiteUrl`), todos vindos do
  `.env`. Não existe tabela no banco com esse tipo de informação, então
  não há query aqui — só configuração.
- `src/db/serverStatusRepository.js` — única query nova, contra
  `MEMB_STAT`.
- Testes em `tests/server.test.js` (banco mockado).

## Decisão — único servidor (confirmada com você)

A coluna `ServerName` existe na `MEMB_STAT` mas você confirmou que é um
único servidor/mundo — por isso `/server/status` devolve um único objeto
agregado, sem filtrar/agrupar por `ServerName`. Se no futuro isso virar
multi-servidor, a query precisa de `GROUP BY ServerName` e o endpoint
passa a devolver uma lista.

## `status: "online"` reflete a API/banco respondendo

A API não tem como saber se o executável do GameServer está de pé sem
falar com ele diretamente (isso exigiria implementar o protocolo binário
do ConnectServer, fora do escopo desta sessão). Se o SQL Server cair, a
rota retorna erro (não um `"offline"` silencioso) — trate isso no
front-end como "servidor indisponível".

## Pendências / passos manuais seus

1. Rodar `npm test` para conferir a nova suíte.
2. Preencher os campos opcionais de `/server/info` no `.env`
   (`SERVER_NAME`, `SERVER_SEASON`, `SERVER_EXP_RATE`, `SERVER_DROP_RATE`,
   `SERVER_MAX_RESETS`) se quiser que apareçam preenchidos — se deixar em
   branco, a rota simplesmente devolve string vazia nesses campos.
3. Testar `GET /api/v1/server/status` contra o banco real e comparar o
   `playersOnline` com quem está de fato logado, antes de expor a rota no
   site.

## Escopo funcional — concluído

Essa era a última seção pendente do escopo funcional do `CLAUDE.md` (a
Seção 6/Notícias original foi pulada por decisão sua, e as antigas
Downloads/Guild/Eventos foram removidas do escopo). Não há mais "próxima
seção" numerada — qualquer trabalho daqui pra frente (deploy, testes
contra produção, credenciais pendentes) é sobre pendências já listadas
nos docs anteriores, não escopo funcional novo.
