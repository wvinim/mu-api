# Seção 6 — Suporte / Tickets — concluída

## O que foi feito

- `POST /api/v1/support/tickets` — cria um ticket; a mensagem enviada
  vira a primeira resposta. Rate limit configurável (padrão 5/hora por
  conta, `RATE_LIMIT_TICKET_CREATE_MAX`/`_WINDOW_MINUTES`).
- `GET /api/v1/support/tickets` — paginado. **Jogador comum** vê só os
  próprios tickets; **staff/admin** (mesma lista fixa do `.env` da Seção
  2) veem todos os tickets de todo mundo.
- `GET /api/v1/support/tickets/:id` — detalhe + todas as respostas em
  ordem cronológica. Dono do ticket ou staff/admin only — outro jogador
  recebe **404** (não 403), pra não confirmar que aquele ID existe.
- `POST /api/v1/support/tickets/:id/reply` — adiciona uma resposta.
  Mesma regra de acesso do detalhe.
- `POST /api/v1/support/tickets/:id/close` — encerra o ticket (`Status`
  vira `'closed'`). Mesma regra de acesso do detalhe (dono ou
  staff/admin). Retorna **409** se o ticket já estiver encerrado.
- `GET /api/v1/support/tickets` agora aceita `?status=open|closed`.
  **Sem esse filtro, tickets encerrados não aparecem na listagem de
  staff/admin** (default passa a ser `status=open` só para essa
  listagem) — pra ver os encerrados é preciso pedir
  `?status=closed` explicitamente. A listagem do jogador comum
  (`findByAccount`) continua mostrando todos os status por padrão,
  e aceita o mesmo filtro se quiser restringir.
- Log de auditoria em `WebAuditLog` na criação de ticket, em cada
  resposta e no encerramento (`support.ticket_closed`).
- Migration `migrations/0003_support_tickets.sql` (`WebSupportTickets`,
  `WebSupportReplies`) — não aplicada.
- Testes em `tests/support.test.js`, cobrindo as regras de
  acesso (dono vs. outro jogador vs. staff).

## Decisões tomadas (não pedidas explicitamente)

- **Sem endpoint de reabrir ticket.** Só fechar. Se precisar reabrir,
  fica pra quando você pedir — provavelmente `POST .../reopen` restrito
  a staff/admin, seguindo o mesmo padrão do close.
- **Reply em ticket encerrado continua permitido.** Não bloqueei resposta
  em ticket com `status='closed'` porque não foi pedido; se quiser esse
  bloqueio (e nesse caso, quem pode ainda responder — só staff pra
  reabrir implicitamente?), me avise antes de eu mudar esse comportamento.
- **Papel do autor de cada resposta** (`authorRole`) é calculado na
  leitura (via a mesma lista fixa `ADMIN_USERNAMES`/`STAFF_USERNAMES`),
  não guardado na tabela — evita duas fontes de verdade sobre quem é
  staff.

## Pendências / passos manuais seus

- Aplicar `migrations/0003_support_tickets.sql`.
- Rodar `npm test`.

## Próxima seção

Restam Seção 7 (Administração) e Seção 8 (Status do servidor) — ambas
sem bloqueios de schema no que já temos, mas a 8 precisa que você diga
de onde ler "servidor online/quantos players conectados" (tabela do
banco ou outro mecanismo).
