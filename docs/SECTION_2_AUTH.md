# Seção 2 — Autenticação (JWT) — concluída e validada em produção

## ✅ Validação end-to-end (feita por você, em produção, conta `apitest01`)

register → confirm-email → login → refresh-token → change-password →
login com a senha nova → limpeza da conta de teste. Tudo funcionou,
incluindo o mapeamento de `mail_chek` (`'0'`→`'1'` ao confirmar, login
bloqueado até isso acontecer) e a atualização sincronizada de
`memb__pwd`/`WebPasswordHash` na troca de senha.

## Passo manual que já foi feito

Migration `migrations/0001_web_auth_tables.sql` aplicada em produção
(precisou de uma correção de collation na v2 — `MEMB_INFO.memb___id` usa
uma collation diferente da padrão do banco; o script agora detecta isso
sozinho). As 3 tabelas (`WebRefreshTokens`, `WebAccountTokens`,
`WebAuditLog`) existem e estão em uso.

Esta seção precisa de **3 tabelas novas** que não existem ainda:
`WebRefreshTokens`, `WebAccountTokens`, `WebAuditLog`. O SQL está em
[`migrations/0001_web_auth_tables.sql`](../migrations/0001_web_auth_tables.sql)
— **não foi executado**. Revise e aplique manualmente (SSMS/sqlcmd) antes de
testar qualquer rota de `/auth`. Nenhuma coluna existente de `MEMB_INFO` é
alterada; as 3 tabelas novas têm FK para `MEMB_INFO(memb___id)` (exceto
`WebAuditLog`, sem FK de propósito, para conseguir logar tentativas de
login com username inexistente).

Se existir um banco de staging/cópia, teste a migration e as rotas lá
primeiro — ainda não me disse se existe um.

## Convenções confirmadas com você (schema real do `MEMB_INFO`)

- `memb___id` `varchar(10)` → limite de tamanho do **username**.
- `memb__pwd` `varchar(10)` → limite de tamanho da **senha** (mesma senha
  usada no jogo e no site, por decisão de negócio). Escolhida a opção de
  **manter o limite de 10** — sem migration.
- `bloc_code`: `'0'` = conta ativa, `'1'` = banida (confirmado por você).
- `mail_chek`: reaproveitado como flag de confirmação de e-mail —
  **decisão adotada**: `'0'` = pendente, `'1'` = confirmado. Isso casa com
  o `DEFAULT` já existente na coluna (`1`), então contas antigas/criadas
  fora da API continuam podendo logar no site sem precisar confirmar nada
  retroativamente. **Se essa direção do mapeamento estiver invertida no
  seu core, me avise antes de ir para produção** — é fácil de trocar, mas
  não dá pra adivinhar com 100% de certeza sem ver o gameserver.
- `ctl1_code`: por decisão sua, fica **sempre `'0'`** nas contas criadas
  pela API — não representa papel/role neste core.
- **Papel (player/staff/admin)**: por decisão sua, via lista fixa no
  `.env` (`ADMIN_USERNAMES`, `STAFF_USERNAMES`), sem coluna nova. Trocar
  staff/admin exige editar o `.env` e reiniciar o processo — não tem
  painel para isso ainda (fica para a Seção 7, se você quiser evoluir).

## O que foi feito

- **Registro** (`POST /auth/register`): grava `memb__pwd` (texto puro,
  formato confirmado por você) e `WebPasswordHash` (bcrypt, custo 12) na
  mesma transação de INSERT. `memb_name` (NOT NULL, sem campo próprio no
  escopo) recebe o mesmo valor do username — decisão de baixo risco, fácil
  de mudar se você quiser coletar um "nome" separado depois.
  `mail_chek='0'` (pendente), `bloc_code='0'`, `ctl1_code='0'`.
  Envia e-mail de confirmação (token opaco, TTL 24h, guardado com hash
  SHA-256 em `WebAccountTokens`).
- **Confirmação de e-mail** (`POST /auth/confirm-email`): consome o token
  (uso único) e seta `mail_chek='1'`.
- **Reenvio de confirmação** (`POST /auth/resend-confirmation`): rate
  limit 3/hora por e-mail. Nunca revela se o e-mail existe ou não —
  mesma resposta sempre (decisão de segurança consistente com
  forgot-password, mesmo o brief não exigindo isso explicitamente aqui).
- **Login** (`POST /auth/login`): valida contra `WebPasswordHash` via
  bcrypt (nunca compara texto puro no fluxo do site). Bloqueia banido
  (`ACCOUNT_BANNED`) e e-mail não confirmado (`EMAIL_NOT_CONFIRMED`).
  Rate limit 5/15min por IP **e** por username (dois limiters
  encadeados). Toda tentativa (sucesso ou falha, com o motivo) vai para
  `WebAuditLog`.
- **Refresh token** (`POST /auth/refresh-token`): **rotativo (uso
  único)** — decisão tomada e justificada no código
  (`src/services/tokenService.js`): a cada uso, o token é revogado e um
  novo é emitido; se um token já revogado for reapresentado, tratamos
  como sinal de possível roubo e revogamos **toda** a família de refresh
  tokens da conta. É um JWT assinado (conforme a stack definida), mas o
  hash também fica em `WebRefreshTokens` para permitir essa revogação —
  um JWT puramente stateless não permitiria isso.
- **Logout** (`POST /auth/logout`): revoga o refresh token informado.
- **Esqueci minha senha** (`POST /auth/forgot-password`): nunca revela se
  o e-mail existe. Como `mail_addr` **não tem índice único** na tabela,
  se dois cadastros compartilharem o mesmo e-mail (deveria ser raro, mas
  o schema permite), a API não envia nada e só audita a ambiguidade — ver
  pendência abaixo sobre um índice único opcional.
- **Reset de senha** (`POST /auth/reset-password`): token de uso único,
  TTL 1h, atualiza as duas colunas de senha e **revoga todos os refresh
  tokens ativos da conta** (mesma lógica de segurança do change-password,
  mesmo o brief não pedindo isso explicitamente aqui).
- **Troca de senha autenticada** (`POST /auth/change-password`): exige
  `currentPassword` correta, atualiza as duas colunas, revoga refresh
  tokens ativos.
- Middleware `requireAuth` (valida access token JWT) e `requireRole`
  (player < staff < admin, hierárquico).
- Testes Jest + Supertest (`tests/auth.test.js`) cobrindo os caminhos
  críticos pedidos no brief: registro (com limite de senha), login
  (sucesso + 3 cenários de bloqueio), refresh token (rotação + detecção
  de reuso), change-password. **Não testam contra um SQL Server real** —
  o acesso ao banco é mockado (`jest.mock` nos repositórios em `src/db/`),
  porque não tenho uma conexão de teste disponível.

## Decisões técnicas (não pedidas explicitamente, mas necessárias)

- Custo do bcrypt: **12** (padrão de mercado atual, ainda rápido o
  suficiente para uma API de site).
- Refresh token continua sendo um **JWT** (a stack pede JWT para
  autenticação), mas com hash persistido em `WebRefreshTokens` para
  viabilizar revogação/rotação — um JWT sozinho não permite isso.
- Tokens de confirmação de e-mail e reset de senha são **opacos**
  (aleatórios, não JWT), guardados com hash SHA-256 — mais simples de
  invalidar de forma garantida (uso único via coluna `UsedAt`) do que
  gerenciar uma blocklist de JWTs.
- Nenhum teste de e-mail real: se `SMTP_HOST` não estiver configurado, o
  `emailService` só loga o e-mail que seria enviado (não falha o fluxo) —
  útil para dev local antes de eu te pedir as credenciais SMTP.

## Pendências / passos manuais seus

Resolvidas: migration aplicada, mapeamento de `mail_chek` confirmado
correto na prática, `npm install`/bcrypt funcionaram no seu Windows
Server (sem precisar trocar de biblioteca). Ainda em aberto:

1. **Credenciais SMTP** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
   `SMTP_PASSWORD`, `SMTP_FROM`) — sem isso, confirmação de e-mail e
   reset de senha não enviam e-mail de verdade (só logam no console,
   como você já viu no teste).
2. **`ADMIN_USERNAMES`/`STAFF_USERNAMES`** no `.env` — preencha com os
   usernames reais que devem ter acesso a rotas de staff/admin (ainda
   nenhuma rota admin foi construída — isso é usado a partir da Seção 7,
   mas o middleware já está pronto).
3. **Opcional, não bloqueante**: considerar um índice único em
   `mail_addr` se você quiser garantir que cada e-mail pertence a uma
   única conta (hoje o schema permite duplicatas, o que degrada
   forgot-password para "não faz nada" nesse caso raro). Só faço isso se
   você aprovar — é mais uma migration revisável.

## Próxima seção

Seção 3 (Perfil da conta) não tem nenhum "pergunte antes" explícito no
brief além do que já foi resolvido aqui (role, schema). Posso seguir
direto, a menos que você quera revisar algo desta seção antes.
