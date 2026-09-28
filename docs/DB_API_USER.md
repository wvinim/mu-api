# Usuário dedicado da API no SQL Server

A API (Oracle Cloud) conectava no SQL Server (VPS) como `sa`. Agora ela usa
o login `mu_api`, criado por `migrations/0009_api_db_user.sql`, que só tem
as permissões que o código de `src/db/` realmente usa (tabela no topo do
script).

O que o `mu_api` **não** consegue fazer, mesmo se a API for comprometida:

- DDL de qualquer tipo (`DROP`, `ALTER`, `CREATE`), nem ler/alterar outros bancos
- Escrever em `Character` ou `MEMB_STAT` (só leitura)
- Alterar colunas de `MEMB_INFO` fora da lista (ex: `memb___id`, `mail_addr`, `ctl1_code`)
- Ler `MEMB_INFO.memb__pwd` (senha em texto puro do jogo) — só gravar
- Apagar ou alterar o `WebAuditLog` (append-only)
- Apagar linhas de qualquer tabela, exceto `MEMB_AUTOPICK_ITEMS` e `WebShopBundleItems`

## Passos manuais

1. Gere uma senha forte (em qualquer máquina Linux):
   `openssl rand -base64 32`
2. No SSMS, conectado como `sa` na VPS, abra `migrations/0009_api_db_user.sql`,
   troque `TROQUE_ESTA_SENHA` pela senha gerada e rode. Não salve o arquivo
   com a senha real. As duas consultas no fim mostram as permissões dadas;
   a segunda deve voltar vazia.
3. No servidor da API (Oracle), edite o `.env`:
   ```bash
   nano .env   # DB_USER=mu_api  e  DB_PASSWORD=<senha gerada>
   pm2 restart <nome-do-processo>
   pm2 logs --lines 50   # deve aparecer "Conectado ao SQL Server"
   ```
4. Teste no site as rotas que escrevem: login, trocar senha, compra na loja,
   ticket de suporte, autopick, e uma ação de admin (ban/unban). Se algo
   quebrar, o log mostra `The ... permission was denied on the object '...'`
   — me passe a mensagem que eu ajusto o GRANT. Para voltar atrás
   rapidamente: recoloque `sa` no `.env` e `pm2 restart`.

Os scripts de diagnóstico em `scripts/dump*.js` leem `sys.columns`/`sys.indexes`
e podem precisar ser rodados com um login de admin; não são usados pela API.

## Quando o código mudar

Todo repositório novo (ou query nova) que tocar uma tabela/coluna fora da
lista do script precisa de um GRANT novo, em uma migration nova numerada.
Tabelas criadas por migrations futuras também precisam de GRANT explícito —
o `mu_api` não herda nada automaticamente.
