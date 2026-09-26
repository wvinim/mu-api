# Assinatura DKIM dos e-mails da API

## Contexto

O relatório DMARC da Microsoft (23/09/2026) mostrou os e-mails de
`@mupro.vip` com **SPF pass, DKIM fail** — o SMTP da Umbler não assina, e o
painel dela não tem opção de DKIM. O DNS do domínio está na **GoDaddy**
(`ns59/ns60.domaincontrol.com`), não na Umbler.

Decisão: a **própria API assina** os e-mails via opção `dkim` do Nodemailer
(`src/services/emailService.js`). A Umbler só retransmite a mensagem já
assinada.

## Decisões

- Seletor **`api`** (não `default`), para não colidir com uma chave que a
  Umbler venha a publicar no futuro.
- RSA 2048.
- Opcional por `.env`: com `DKIM_DOMAIN`, `DKIM_SELECTOR` e
  `DKIM_PRIVATE_KEY_PATH` todos vazios, nada muda (dev/testes). Configuração
  **parcial** ou chave ilegível → erro no envio (fica no log), em vez de
  mandar e-mail sem assinatura silenciosamente.
- Limitação: só os e-mails **enviados pela API** (confirmação, reset de
  senha) saem assinados. E-mails do webmail/Outlook da conta Umbler não.

## Passos manuais

1. No servidor, gere o par de chaves **fora da pasta do projeto**:
   ```
   npm run generate-dkim-key -- ~/mu-api-secrets/dkim-api.pem api
   ```
   (sem argumentos grava em `secrets/dkim-api.pem`, que está no
   `.gitignore`). O script se recusa a sobrescrever uma chave existente.
2. Na GoDaddy → DNS de `mupro.vip` → Adicionar registro:
   - Tipo `TXT`, Nome `api._domainkey`, Valor = a linha `v=DKIM1; k=rsa; p=...`
     impressa pelo script (inteira, numa linha só).
3. No `.env` do servidor:
   ```
   DKIM_DOMAIN=mupro.vip
   DKIM_SELECTOR=api
   DKIM_PRIVATE_KEY_PATH=/home/<usuario>/mu-api-secrets/dkim-api.pem
   ```
   (a chave é gravada com permissão 600 — o usuário que roda o Node precisa ser o dono) e reinicie a API.
4. Depois da propagação: `npm run check-dkim` (compara o TXT publicado com a
   chave privada). Deve imprimir `OK`.
5. Teste real: dispare um "esqueci a senha" para uma conta Gmail →
   "Mostrar original" → `DKIM: PASS com o domínio mupro.vip`. Se der FAIL
   com `body hash did not verify`, o SMTP da Umbler está alterando a
   mensagem em trânsito — avisar para investigarmos.
6. Com alguns dias de relatórios DMARC mostrando SPF **e** DKIM pass,
   endurecer o DMARC: `p=quarantine` e depois `p=reject`.

## Troca de chave

Gere uma nova com outro seletor (ex: `api2`), publique o TXT, troque
`DKIM_SELECTOR`/`DKIM_PRIVATE_KEY_PATH`, reinicie, e só remova o TXT antigo
alguns dias depois.
