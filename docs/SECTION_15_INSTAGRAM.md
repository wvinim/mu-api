# Seção 15 — Campanha "story no Instagram" (planejamento, 2026-11-25)

> Status: **implementado** (2026-11-25), com resposta automática no Direct.
> Migration `0018_instagram_campaign.sql` **pendente**: aplicar ANTES do deploy.
> Lança desligado (`INSTAGRAM_CAMPAIGN_ENABLED=false`): primeiro teste com
> `INSTAGRAM_TESTERS`. Contrato para o front em `docs/API_REFERENCE.md`.

## O que faz
O jogador vincula o Instagram à conta do site, posta um story marcando o
perfil do servidor (**@muproserver**) e recebe **40 gold** (`MEMB_INFO.Cash`) automaticamente
quando o webhook da Meta chega.

## Decisões (usuário, 2026-11-25)
- **Prêmio uma vez por Instagram E uma vez por conta do site** (a segunda trava
  foi adicionada em 2026-11-25, a pedido do usuário, para impedir juntar 40 gold
  por Instagram numa conta só). Cada IGSID é premiado uma única
  vez na vida, mesmo se for desvinculado e vinculado a outra conta do jogo.
- **Conta privada também vale.** A API da Meta não informa se a conta é
  pública ou privada, então isso nem seria verificável.
- **Mínimo de 50 seguidores**, conferido no momento do crédito via
  `follower_count` da User Profile API. Com menos de 50 seguidores, a menção
  fica registrada como `rejected_followers` e o jogador pode tentar de novo
  depois de passar de 50.
- **Sem prazo.** Um flag `INSTAGRAM_CAMPAIGN_ENABLED` liga e desliga a
  campanha sem deploy de código.
- **Vínculo por código enviado no Direct.** O site gera um código (ex.:
  `MUPRO-7K3F`, curto, TTL de 30 min) e o jogador manda esse código no Direct
  do perfil do servidor. O webhook `messages` recebe a mensagem e vincula o
  IGSID à conta. Isso prova que a pessoa é dona do @, gera o consentimento
  que a User Profile API exige, e o IGSID não muda se ela trocar o @.

## Como a Meta entrega a menção
- Não chega pelo webhook `mentions`, que não cobre stories. Chega pelo
  webhook **`messages`**, com o anexo `type: "story_mention"` e
  `payload.url` (URL de CDN temporária).
- O payload traz só o **IGSID** (`sender.id`). O @ e o `follower_count` vêm
  de `GET graph.instagram.com/<IGSID>?fields=username,follower_count`, que
  exige consentimento. O código enviado no Direct já gera esse consentimento.
- **Autenticidade:** header `X-Hub-Signature-256` = `sha256=` +
  HMAC-SHA256(corpo bruto, App Secret). Valide com comparação de tempo
  constante antes de qualquer processamento.
- **Reenvio:** a Meta tenta de novo por até 36h e manda eventos em lote.
  Idempotência por `message.mid` UNIQUE.
- Responder 200 rápido. Assinatura inválida → 401, sem processar.

## Fluxo
1. O jogador logado pede um código → `POST /account/instagram/link-code`.
2. Ele manda o código no Direct → webhook (mensagem de texto) → se o código
   for válido e não expirado, grava o vínculo e consome o código. Se o IGSID
   já estiver vinculado a outra conta do jogo, recusa.
3. Ele posta um story marcando o perfil → webhook (`story_mention`) →
   resolve a conta pelo IGSID → consulta `follower_count` → se tiver 50 ou
   mais e o IGSID nunca tiver sido premiado: transação atômica com
   `UPDATE MEMB_INFO SET Cash = Cash + 40` + marca o IGSID como premiado +
   auditoria `instagram.story_reward`.
4. Uma menção de IGSID sem vínculo fica gravada como `unlinked`. **Decidido
   (2026-11-25):** ao vincular, premia retroativamente uma menção `unlinked`
   desse IGSID postada até 7 dias antes do vínculo.

## Rascunho técnico
**Migration `0018_instagram_campaign.sql`** (aditiva, com GRANTs para o
`mu_api`, collation dinâmica para o FK de conta):
- `WebInstagramLinks (Username PK, Igsid UNIQUE, IgUsername, LinkedAt)`
- `WebInstagramLinkCodes (Code PK, Username, ExpiresAt, UsedAt)`
- `WebInstagramRewards (Igsid PK, Username, Amount, MentionMid, CreatedAt)`.
  A PK no IGSID garante "uma vez por Instagram" mesmo depois de
  desvincular.
- `WebInstagramMentions (Mid PK, Igsid, MediaUrl, Status, FollowerCount,
  CreatedAt)`, que guarda o histórico e a auditoria das menções recebidas.

**Rotas:**
- `GET /api/v1/instagram/webhook` (verificação `hub.challenge` com
  `hub.verify_token`), `POST /api/v1/instagram/webhook` (corpo bruto + HMAC).
- `POST /account/instagram/link-code`, `GET /account/instagram` (vínculo e
  status do prêmio), `DELETE /account/instagram`.

**Config (.env):** `INSTAGRAM_APP_SECRET`, `INSTAGRAM_VERIFY_TOKEN`,
`INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID`, `INSTAGRAM_REWARD_CASH=40`,
`INSTAGRAM_MIN_FOLLOWERS=50`, `INSTAGRAM_CAMPAIGN_ENABLED`.
O token de longa duração vale 60 dias e precisa de renovação automática
(job diário via `GET /refresh_access_token`, guardado no banco).

**Testes Jest:** HMAC (válido, inválido, corpo alterado), idempotência por
`mid`, vínculo por código (expirado, reutilizado, IGSID já vinculado),
regra de 50 seguidores, prêmio único por IGSID e texto SQL dos repositórios.

**mu-front:** hotsite público `/instagram` (antes era um card em Minha Conta) com o código, as instruções
("mande este código no Direct de @muproserver"), o @ vinculado e o status do
prêmio (pendente / recebido / menos de 50 seguidores).

## Roteiro de validação (fase atual)
Código de teste já no repo: `GET/POST /api/v1/instagram/webhook`
(`src/routes/instagram.js`). Valida a assinatura e registra no log o payload
e o resultado da consulta de perfil. **Não grava no banco nem credita.**

1. **Instagram do servidor:** conta profissional + "Permitir acesso às
   mensagens" (Configurações → Mensagens e respostas a stories →
   Ferramentas conectadas).
2. **Política de privacidade** publicada (ex.: `https://mupro.vip/privacidade`).
   A Meta exige isso para o app ir para Live.
3. **App na Meta**: o painel novo só oferece **Unified Login**, e o Instagram
   Login não aparece mais para apps novos. Com ele, o token é de **usuário do
   sistema**, o host é `graph.facebook.com` e o segredo que valida o webhook é
   a **Chave secreta do app da Meta** (Configurações → Básico), não o
   "Instagram App Secret". O app precisa pertencer a um **portfólio
   empresarial**. Uma Página do Facebook não é necessária. Se o Instagram
   estiver ligado a uma Página, compartilhe a Página também, senão o webhook
   `messages` pode não chegar (limitação temporária documentada pela Meta).
   - Casos de uso → Gerenciar mensagens e conteúdo no Instagram → Personalizar
     → API setup with unified login → Gerar tokens de acesso com o
     @muproserver → `INSTAGRAM_ACCESS_TOKEN`. O token aparece só uma vez.
   - Chave secreta do app → `INSTAGRAM_APP_SECRET`.
   - Invente um texto → `INSTAGRAM_VERIFY_TOKEN`.
   - Para a User Profile API no Unified Login, a doc não confirma host nem
     campos. O teste diz: `INSTAGRAM_GRAPH_HOST` (padrão `graph.facebook.com`).
4. **Deploy** com as 3 variáveis no `.env` de produção.
5. **Webhook no painel:** Callback URL
   `https://api.mupro.vip/api/v1/instagram/webhook` + Verify token →
   "Verify and save" → assinar o campo **`messages`**. Log esperado:
   `instagram webhook: verificação aceita`. No Unified Login também é preciso
   inscrever a conta: `POST graph.facebook.com/v27.0/<IG_ACCOUNT_ID>/subscribed_apps`
   com `subscribed_fields=messages` e o token → `{"success": true}`.
6. **Teste A, conta com papel no app** (adicionada como Instagram Tester):
   mandar um Direct com texto e depois marcar o perfil num story. Isso confirma
   que o fluxo funciona.
7. **Teste B, conta SEM papel no app** (qualquer amigo): mesmo teste. Com o
   app em Development, provavelmente não chega nada. Coloque o app em
   **Live** e repita.
   - Se chegar: dá para lançar sem App Review.
   - Se não chegar: é preciso **App Review (Advanced Access para
     `instagram_business_manage_messages`) + verificação de empresa**.
8. Colar os logs (`pm2 logs mu-api | grep -i instagram`) para fechar o
   formato real do `story_mention` e conferir se `profile.body` traz
   `username` e `follower_count`.

## Resultados dos testes
**Teste A (2026-11-25), conta pessoal do usuário, app em Development:** funcionou.
- O Direct ("Oi") e o story com menção chegaram com assinatura válida, vindos
  de IPs da Meta (UA `facebookexternalua`).
- Formato real do story (`entry[].id` = ID da conta @muproserver):
  ```json
  {"object":"instagram","entry":[{"time":1795628057330,"id":"17841440190434640",
    "messaging":[{"sender":{"id":"<IGSID>"},"recipient":{"id":"17841440190434640"},
      "timestamp":1795628056487,
      "message":{"mid":"<mid>","attachments":[{"type":"story_mention",
        "payload":{"url":"https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=...&signature=..."}}]}}]}]}
  ```
- A User Profile API em `graph.facebook.com/<IGSID>` com o token do Unified
  Login devolveu 200 com `username`, `name`, `follower_count`,
  `is_user_follow_business` e `is_verified_user`.
- `follower_count` veio 0, e o usuário confirmou que a conta tem mesmo 0
  seguidores.

**Teste B (2026-11-25), conta separada (@natvinimoraes), app em Development:**
funcionou igual. Chegaram o Direct e o `story_mention`, e o perfil voltou com
`follower_count: 6` (valor real). **Conclusão: viável sem App Review.**

**Teste C (2026-11-25), Direct de um jogador sem nenhuma ligação com o dono do
app:** chegou, e o perfil voltou com `follower_count: 152`. Confirma que
funciona para jogadores reais com o app em Development.

## Passos manuais do usuário (antes de codar)
1. Perfil do servidor como **conta profissional** (Business ou Creator).
2. No Instagram: Configurações → Mensagens → Ferramentas conectadas →
   **Permitir acesso às mensagens**.
3. Criar o app em developers.facebook.com (produto Instagram, "API with
   Instagram Login"), com as permissões `instagram_business_basic` e
   `instagram_business_manage_messages`, e assinar o webhook `messages`.
4. Publicar a política de privacidade em mupro.vip e colocar o app em
   **Live**.
5. Provavelmente: **App Review (Advanced Access) + verificação de empresa**
   para receber eventos de quem não tem papel no app. Não está claro na
   doc.

## Próximo passo
Teste mínimo antes de implementar: subir só o endpoint do webhook (log do
payload, sem crédito). Uma conta **sem papel no app** manda um Direct e
marca o perfil num story. Confirmar (a) se os eventos chegam sem App
Review, (b) o JSON real do `story_mention` e (c) se a User Profile API
devolve `username`/`follower_count` depois do Direct.

## Implementação (2026-11-25)
- `src/routes/instagram.js`: webhook (GET verificação, POST com HMAC) e rotas
  `/account/instagram`. O webhook processa **antes** de responder 200. Erro de
  banco ou de perfil responde 500, e a Meta reenvia (tudo é idempotente: menção
  por `mid`, código marcado como usado com o IGSID).
- `src/services/instagramCampaignService.js`: regras e textos do Direct. O login
  da conta do jogo **nunca** vai no Direct. Mensagens comuns do Direct (sem
  código) são ignoradas e **não são logadas**.
- `src/services/instagramGraph.js`: perfil (`username,follower_count`) e envio
  de mensagem (`POST /<IG_ACCOUNT_ID>/messages`, ID vindo do `entry.id` do
  webhook). O envio usa a mesma permissão `instagram_manage_messages` do
  webhook. Resposta só vale até 24h após a última mensagem da pessoa.
- `src/db/instagramRepository.js`: prêmio atômico (trava no IGSID + INSERT +
  `Cash = Cash + 40` + status da menção, tudo ou nada).
- Campanha desligada: menções viram `disabled` (sem resposta), `link-code`
  responde 403, e as contas de `INSTAGRAM_TESTERS` funcionam normalmente.
  Teste precisa vincular ANTES de postar (com a campanha desligada, story sem
  vínculo não vira `unlinked`).
- Unlink permitido: o prêmio fica preso ao IGSID **e** à conta
  (`WebInstagramRewards`: PK no IGSID + trava pelo índice de Username dentro da
  transação do prêmio). Desvincular e vincular de novo, ou trocar de Instagram,
  não paga outra vez. Status `account_rewarded` = conta já premiada com outro
  Instagram.

## Deploy e teste
1. Aplicar `migrations/0018_instagram_campaign.sql`.
2. `.env`: `INSTAGRAM_CAMPAIGN_ENABLED=false` e `INSTAGRAM_TESTERS=<sua conta>`
   (demais variáveis em `.env.example`).
3. Deploy de API + front.
4. Em `/instagram` (logado na conta de teste): gerar código → mandar no
   Direct do @muproserver de um Instagram com 50+ seguidores → conferir a
   resposta "vinculado" → postar story marcando @muproserver → conferir a
   resposta "gold creditado" e o Cash da conta.
5. Liberar: `INSTAGRAM_CAMPAIGN_ENABLED=true` + restart.

Consultas úteis (SSMS):
```sql
SELECT TOP 50 * FROM WebInstagramMentions ORDER BY CreatedAt DESC;
SELECT * FROM WebInstagramRewards ORDER BY CreatedAt DESC;
SELECT COUNT(*) AS premiados, SUM(Amount) AS gold FROM WebInstagramRewards;
```

## Limite de chamadas da Graph API (2026-11-25)
O painel da Meta mostra o limite do app: 200 chamadas por hora × usuários do
app. Aqui o app tem 1 usuário, então no pior caso são ~200 por hora. Não está
claro se as chamadas do Instagram usam esse limite ou o limite por conta
(Business Use Case).
- O vínculo **não** consulta o perfil. O @ é gravado no vínculo quando o story
  chega (a consulta já acontece ali, para contar os seguidores). Ficam ~3-4
  chamadas por jogador: 1 perfil + 2-3 respostas no Direct.
- `instagramGraph.js` lê `X-App-Usage` e `X-Business-Use-Case-Usage` de toda
  resposta. Com 75% ou mais, loga `limite de chamadas da Graph API perto do fim`
  (warn). Com erro de limite (códigos 4, 17, 32, 613, 80002), loga
  `limite de chamadas da Graph API atingido` (error).
- Limite estourado não perde prêmio: a menção vira `profile_error`, o webhook
  responde 500 e a Meta reenvia por até 36h. Resposta no Direct que falha só
  gera log.
```bash
pm2 logs mu-api --lines 500 --nostream | grep -i "limite de chamadas"
```
