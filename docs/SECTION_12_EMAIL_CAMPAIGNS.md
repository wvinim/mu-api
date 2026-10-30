# Seção 12 — Campanhas de e-mail de divulgação (2026-10-30)

## O que faz
Envia e-mails de divulgação (ex.: inauguração) para as contas, a partir do
painel de admin, com descadastro.

- **Destinatários:** toda conta **não banida** com e-mail preenchido
  (confirmado ou não). Um envio por e-mail: contas antigas que dividem o
  mesmo e-mail recebem uma vez só, com o nome da primeira conta criada.
  Quem se descadastrou e quem já recebeu a campanha ficam de fora.
- **Teste primeiro:** `POST /admin/email-campaigns/:key/test` manda só para
  o seu e-mail (ou para `to`), com `[TESTE]` no assunto. Não grava nada.
- **Envio em lote em segundo plano:** `POST .../send` responde 202 na hora
  e envia um e-mail por vez, com pausa de `EMAIL_CAMPAIGN_DELAY_MS` entre
  eles (limite de envio da Umbler). Acompanhe com `GET .../:key`.
- **Sem duplicar:** cada envio fica em `WebEmailCampaignSends`. Disparar de
  novo (depois de um restart, de um cancelamento ou de falhas) só manda
  para quem ainda não recebeu.
- **Para sozinho** após `EMAIL_CAMPAIGN_MAX_CONSECUTIVE_FAILURES` falhas
  seguidas (ex.: o SMTP bloqueou por excesso de envio). O motivo fica em
  `job.error`; espere e dispare de novo.
- **Descadastro:** link no rodapé e cabeçalhos `List-Unsubscribe` +
  `List-Unsubscribe-Post` (descadastro com um clique, exigido por Gmail e
  Yahoo para envio em massa). Só bloqueia divulgação: e-mails de conta
  (confirmação, senha, presente) continuam chegando.

## Decisões
- **Campanhas são código**, em `src/emails/campaigns/` (registro em
  `index.js`). A chave (ex.: `inauguracao`) identifica os envios no banco:
  nunca renomeie uma chave já enviada.
- **Job em memória** (instância única, mesma decisão do rate limit): um
  restart da API interrompe o envio, mas nada se perde, basta disparar de
  novo.
- **Token de descadastro sem tabela de tokens:** HMAC do e-mail com chave
  derivada de `JWT_ACCESS_SECRET`. Trocar esse segredo invalida os links de
  e-mails já enviados.
- **GET não descadastra:** a página só mostra um botão de confirmação,
  porque antivírus e leitores de link abrem os links dos e-mails sozinhos.
  O POST (botão ou um clique do Gmail) é que grava.
- **Sem JOIN com `MEMB_INFO`** (collation — `docs/DB_NOTES.md`): as três
  listas são lidas separadas e cruzadas no service.
- Auditoria: `admin.email_campaign_test`, `admin.email_campaign_send`,
  `admin.email_campaign_cancel`.

## Passos manuais seus
1. **Revisar e aplicar a migration** `migrations/0014_email_campaigns.sql`
   (cria `WebEmailCampaignSends` e `WebEmailUnsubscribes`, com GRANT para
   `mu_api`). Não mexe em tabela do gameserver.
2. No `.env` de produção:
   ```
   API_PUBLIC_URL=https://api.mupro.vip
   EMAIL_CAMPAIGN_DELAY_MS=2000
   EMAIL_CAMPAIGN_MAX_CONSECUTIVE_FAILURES=5
   ```
   Sem `API_PUBLIC_URL`, teste e envio respondem 503. Ajuste o
   `DELAY_MS` ao limite do seu plano da Umbler (2000 ms = até 1.800/hora).
3. `git pull` + `pm2 restart`.
4. Mande o teste, confira no Gmail e no celular, clique no link de
   descadastro do teste e confirme que a página abre:
   ```bash
   TOKEN=...   # access token de uma conta admin
   curl -X POST https://api.mupro.vip/api/v1/admin/email-campaigns/inauguracao/test \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
   ```
5. Veja quantos vão receber (`pending`) e dispare:
   ```bash
   curl https://api.mupro.vip/api/v1/admin/email-campaigns/inauguracao -H "Authorization: Bearer $TOKEN"
   curl -X POST https://api.mupro.vip/api/v1/admin/email-campaigns/inauguracao/send -H "Authorization: Bearer $TOKEN"
   ```
   Para parar: `POST .../inauguracao/cancel`.
