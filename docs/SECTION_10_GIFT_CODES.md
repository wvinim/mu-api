# Seção 10 — Gold de presente (chaves de resgate)

Adicionado em 2026-10-08. Contrato para o front em `docs/API_REFERENCE.md`
("Gold de presente").

## O que foi feito

- `POST /shop/purchase` aceita `gift: true` (só `credit:*`). A cobrança Pix
  nasce com `IsGift = 1` e uma chave em `WebGiftCodes` com status
  `awaiting_payment`, gravadas na mesma transação.
- Webhook (`pixChargesRepository.markPaidAndCredit`): numa cobrança de
  presente, em vez de creditar o comprador, a chave passa de
  `awaiting_payment` para `available` na mesma transação que marca a
  cobrança como paga. A idempotência é a mesma de antes. Depois do
  commit, a API manda um e-mail com a chave ao comprador
  (`emails/giftCodeEmail.js`). Se o SMTP falhar, o erro só vai para o log
  e o webhook não falha.
- `GET /shop/charges/:txid`: status da cobrança da própria conta. O front
  passou a fazer polling aqui nos dois fluxos (antes comparava o saldo,
  o que não funciona para presente).
- `GET /shop/gift-codes`: chaves do comprador. A chave não aparece
  enquanto aguarda pagamento, e esses registros somem da lista depois de
  `EFI_CHARGE_EXPIRATION_SECONDS`.
- `POST /shop/gift-codes/redeem`: resgate atômico, em que o UPDATE com
  `Status = 'available'` e o crédito de Cash ficam na mesma transação.
  Rate limit de 10 tentativas com erro por hora, por conta e por IP
  (`RATE_LIMIT_GIFT_REDEEM_*`).
- Admin: `GET /admin/gift-codes` (busca por chave, conta e status) e
  `POST /admin/gift-codes/:id/cancel`.
- Histórico: compra de presente aparece como `gift_purchase`, e o resgate
  como `gift_redemption`.

## Decisões

- **Chave**: `MUPRO-XXXX-XXXX-XXXX-XXXX`, alfabeto de 31 caracteres sem
  0/O/1/I/L, cerca de 79 bits (`crypto.randomInt`). Fica guardada em
  texto puro porque o comprador precisa poder recuperá-la. Na auditoria
  e no histórico aparecem só os 4 últimos caracteres.
- **A chave não expira** (crédito pré-pago, Código de Defesa do
  Consumidor). Pode ser resgatada pelo próprio comprador e circula
  livremente. O comprador vê só "resgatada em", não quem resgatou.
- **Gerada na criação da cobrança, não no webhook**: assim o webhook não
  precisa gerar nada e continua sendo um UPDATE idempotente, e fica
  garantido que toda cobrança de presente tem chave.
- **Cancelar só a partir de `available`**: uma chave `awaiting_payment`
  ainda vai ser liberada pelo webhook. Se ela pudesse ser cancelada, o
  pagamento chegaria e o `markPaidAndCredit` daria rollback em loop.
  Cancelar não devolve dinheiro; o estorno é feito no painel da Efí.
- **Resgate com o personagem online**: credita o Cash do mesmo jeito que o
  webhook de compra normal (sem a checagem `CHARACTER_ONLINE`).
- Respostas do resgate: 404 `GIFT_CODE_INVALID` para chave inexistente,
  não paga ou cancelada (mesma resposta nos três casos, para não revelar
  o estado), e 409 só para `GIFT_CODE_ALREADY_REDEEMED`.

## Status

- **Em produção desde 2026-10-08.** A migration 0012 foi aplicada e o
  usuário confirmou que o fluxo funciona.
- Opcional: ajustar `RATE_LIMIT_GIFT_REDEEM_MAX` e
  `RATE_LIMIT_GIFT_REDEEM_WINDOW_MINUTES` no `.env` (o padrão é 10 por 60
  minutos).
