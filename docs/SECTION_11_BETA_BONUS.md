# Seção 11 — Bônus do beta aberto (2026-10-24)

## O que faz
Durante o beta aberto, toda conta nova recebe **500 Cash + Mega Vip**
uma única vez, **no momento em que confirma o e-mail** (não no registro).
Isso exige um e-mail confirmado diferente por conta, o que dificulta criar
contas em massa para farmar Cash. Desliga sozinho em `BETA_BONUS_ENDS_AT`.

## Decisões
- **Pelo código, não por trigger no banco** (decisão do usuário): nada de
  DDL em `MEMB_INFO`, que o gameserver usa ao vivo. Sem migration e sem
  GRANT novo: o `mu_api` já escreve em `Cash`/`Vip`/`VipStartDate`/`VipEndDate`/`mail_chek`.
- **Concessão atômica e única**: o crédito vai no mesmo `UPDATE` que seta
  `mail_chek = '1'`, filtrado por `mail_chek <> '1'`. Duas requisições
  concorrentes com o mesmo token não creditam duas vezes.
- O VIP é gravado do zero (início agora, fim em agora + `BETA_BONUS_VIP_DAYS`),
  sem somar dias: antes de confirmar o e-mail a conta não loga nem compra nada.
- Quem registrou antes do fim do beta mas só confirma depois **não** recebe
  o bônus. O que conta é a data da confirmação.
- Auditoria: evento `account.beta_bonus` com `{ cash, vipTier, vipDays }`.
- A resposta do `POST /auth/confirm-email` ganhou `betaBonus` (ver `API_REFERENCE.md`).

## Passos manuais seus
1. No `.env` de produção:
   ```
   BETA_BONUS_ENDS_AT=2026-10-30T00:00:00-03:00
   BETA_BONUS_CASH=500
   BETA_BONUS_VIP_TIER=3
   BETA_BONUS_VIP_DAYS=30
   ```
   Se o lançamento tiver horário (ex: 19h), ajuste `ENDS_AT` para esse horário.
2. Teste com uma conta nova: confirme o e-mail e confira com
   `npm run dump-vip-status -- <username>` que veio Vip=3 e Cash=500.
3. Contas que **já confirmaram** o e-mail antes deste deploy não recebem o
   bônus. Se quiser dar para elas, o VIP pode ser concedido pelo admin
   (`POST /admin/accounts/:id/vip`). Para o Cash não existe rota de admin,
   então seria preciso um script.
