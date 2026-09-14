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
- Log de auditoria em `WebAuditLog` na criação de ticket e em cada
  resposta.
- Migration `migrations/0003_support_tickets.sql` (`WebSupportTickets`,
  `WebSupportReplies`) — não aplicada.
- Testes em `tests/support.test.js`, cobrindo as regras de
  acesso (dono vs. outro jogador vs. staff).

## Decisões tomadas (não pedidas explicitamente)

- **Sem endpoint de fechar/reabrir ticket nesta seção.** A coluna
  `Status` existe (`'open'`/`'closed'`, default `'open'`), mas nada nesta
  seção altera esse valor — o brief não pediu isso aqui. Fica pronto pra
  quando a Seção 7 (Administração) quiser adicionar
  `PATCH /admin/support/tickets/:id` para staff fechar/reabrir.
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
