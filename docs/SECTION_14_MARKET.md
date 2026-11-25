# Seção 14 — Mercado de itens entre jogadores

Não confundir com a vitrine `/mercado` da Seção 10 antiga (removida em
`c726981`, só exibia itens). Aqui o site **move o item**: sai do baú do
vendedor, fica no mercado, vai para o baú do comprador, e gold (`MEMB_INFO.Cash`)
troca de mão.

## Decisões do usuário (2026-11-24)

1. **Destino** (compra e cancelamento/resgate): o próprio jogador escolhe o baú
   (ativo em `warehouse` ou guardado em `Extwarehouse`).
2. **Origem do anúncio**: baú ativo e baús guardados. Conta precisa estar offline.
3. **Taxa de venda: 10%**. O vendedor recebe `floor(preço × 0,9)`; o resto sai do jogo.
4. **Limites**: no máximo 10 anúncios por conta; preço de 10 a 10.000 gold;
   o anúncio **expira em 7 dias** e fica "expirado" até o dono resgatar.
5. Qualquer conta pode anunciar (não exige VIP).
6. **Itens permitidos**: só asas, sets, armas, escudos, pendants e rings.
   Lista item a item em revisão: `docs/MARKET_ITEMS_REVIEW.md`.
   - Fase 1: drops das Box of Kundun +1..+5, **só a cópia excelente**.
   - Asas: **só as de 1º nível** (Elf, Heaven, Satan; 12:0..12:2). As de 2º nível
     e a Cape of Lord ainda não estão liberadas.
7. A loja do site não vende nada dessas categorias, então não há conflito de revenda.
8. **Serial repetido**: não recusar o anúncio, mas avisar o admin quando o mesmo
   item (serial ≠ 0) for anunciado repetidas vezes.
9. **Sem e-mail** de venda: o site mostra o histórico de compras e vendas.
10. **Imagens**: base em `docs/imgs_shop/`, conferidas item a item (ver o doc de revisão).
11. Migration 0011 (remoção da vitrine): **rodou** (verificado 2026-11-24: objetos NULL,
    nenhum baú com VaultID 200).

## Decisões complementares (2026-11-24)

12. **Expirados contam no limite de 10.** Botão "Renovar" reabre o anúncio expirado
    por mais 7 dias sem mexer no item.
13. **Serial repetido**: tela de admin no site listando seriais anunciados mais de uma vez
    (sem e-mail).
14. **Mercado anônimo**: nenhuma resposta de jogador traz nome ou login do vendedor ou do comprador (nem no histórico): `memb_name` espelha o login da conta, então expor o nome exporia o login. As colunas `SellerName`/`BuyerName` ficam só para auditoria; contas só na tela de admin.
15. **Origem só dos baús** (ativo + guardados). Inventário e equipamento ficam fora.
16. **Imagens faltantes (28)**: usuário vai procurar manualmente; até lá, ícone
    genérico por categoria.

## Banco: migration 0016 (APLICADA em 2026-11-24)

`migrations/0016_market_precheck.sql` (só leitura) roda antes; depois
`migrations/0016_market.sql`. Como o mercado não atrapalha o jogo:

- Só cria coisas novas (`WebMarketListings`, função `WebMarket_SlotChangeOk`,
  procedures `WebMarket_Create/Buy/Return/Renew`) e dá GRANTs. Nada de ALTER em tabela do jogo.
- A API lê o baú sem trava e chama uma procedure; a transação inteira roda
  no SQL Server em uma ida e volta. Nenhuma trava fica aberta esperando a rede.
- Escrita otimista: o UPDATE do baú exige `Items = @oldItems`. Se o baú mudou,
  nada é gravado (Result 3) e a API tenta de novo. Sem HOLDLOCK em `warehouse`
  (sem índice, travaria a tabela inteira).
- `LOCK_TIMEOUT 3000` + `DEADLOCK_PRIORITY LOW`: numa disputa, o mercado desiste.
- Conta offline há mais de 2 minutos (`ConnectStat = 0` e `DisConnectTM`),
  para não correr com o salvamento do baú no logout.
- A procedure confere que o baú novo só difere nos 16 bytes do slot do item.
- `mu_api` só ganha EXECUTE nas procedures e SELECT; não escreve direto em
  `Extwarehouse` nem em `WebMarketListings`.
- Gold do vendedor é creditado mesmo com ele online (o jogo não grava `Cash`).

Pós-checagem (0016_market_postcheck.sql) em 2026-11-24: 14/14 testes da função OK,
GRANTs do mu_api conferidos.

Pré-checagem rodada em 2026-11-24: sem triggers; warehouse 79 linhas (heap, sem
duplicatas), Extwarehouse 150, MEMB_INFO 171; compatibility level 80, RCSI off.
`Extwarehouse.AccountID` é CI_AS e o resto é CS_AS: as colunas de conta do mercado
são CS_AS e as comparações forçam CS_AS. `DisConnectTM` é smalldatetime (minuto).

## Pontos técnicos já levantados

- Item guardado como os **16 bytes originais** (`VARBINARY(16)`), para voltar
  idêntico (serial, excelentes, ancient, harmony), mais colunas decodificadas para busca.
- Decodificador: restaurar `src/services/itemDecoder.js` + catálogo
  (`git show c726981^:src/services/itemDecoder.js`, `scripts/generateItemCatalog.js`).
- Inserção hoje só suporta 1x1: criar `findFreeArea(w,h)` em `itemSlotCodec`.
- Anunciar, cancelar e comprar: cada um numa única transação, com `UPDLOCK`
  mantido até o UPDATE. A `MUDAR_BAU` trava as mesmas linhas, então um `/bau`
  concorrente espera em vez de corromper.
- `mu_api` precisa de GRANT SELECT/UPDATE em `Extwarehouse` (a 0011 revoga a leitura).
- `docs/inv/Item.txt` está defasado em relação ao servidor (Wings of Satan, flag de classe):
  sincronizar antes de gerar o catálogo.

## API (implementada em 2026-11-24, ainda não testada em produção)

Rotas e contrato: `docs/API_REFERENCE.md`, seção "Mercado entre jogadores".

- `src/routes/market.js`, `src/controllers/marketController.js`,
  `src/db/marketRepository.js`, `src/services/marketItemService.js`,
  `src/validators/marketValidators.js`.
- Catálogo: `src/data/marketCatalog.json` (231 itens), gerado por
  `node scripts/generateMarketCatalog.js`. Rode de novo quando mudar as bags,
  as asas liberadas ou as imagens. Lê o `Item.txt` do servidor em
  `../MuPRO/server/Data/Item/Item.txt` ou no caminho passado como argumento.
- `warehouseService.findFreeArea(buffer, w, h)`: primeiro espaço livre do tamanho do item.
- Leitura de baú com `NOLOCK`: a API nunca espera o jogo. Uma leitura suja não
  causa estrago, porque a procedure só grava se o baú ainda for o confirmado
  (compare-and-swap).
- Escrita: até 3 tentativas quando o baú muda no meio (Result 3). Trava ocupada
  ou deadlock no banco viram 503 `MARKET_BUSY` sem nova tentativa: o mercado cede.
- Auditoria (`WebAuditLog`): `market.listing_created`, `market.listing_bought`,
  `market.listing_returned` e `market.listing_renewed`. Falhas inesperadas e de
  concorrência são gravadas com `success = 0`.
- Imagem `docs/imgs_shop/Pants/PantsBone Pants.jpg` renomeada para `Bone Pants.jpg`.
- Testes: `tests/market.test.js` (rotas) e `tests/marketItemService.test.js`
  (decodificação, regra de excelente/asa e `findFreeArea`).

### Passos manuais

1. Deploy normal (`git pull` + `pm2 restart`). Sem `MARKET_ENABLED`, o mercado
   fica desligado para todos.
2. No `.env` de produção: `MARKET_TESTERS=conta1,conta2` (contas de teste) e
   `MARKET_ENABLED=false`. Reinicie o pm2.
3. Roteiro de teste com as contas de teste, offline há mais de 2 minutos:
   - anunciar um item excelente do baú ativo e um de um baú guardado;
   - conferir que o item sumiu do baú no jogo;
   - comprar com a outra conta, mandando para um baú guardado;
   - conferir o gold das duas contas (vendedor recebe 90%);
   - conferir que o item chegou no jogo (`/bau N`) com as mesmas opções;
   - cancelar um anúncio e conferir a volta do item;
   - tentar anunciar com a conta online (precisa dar `ACCOUNT_ONLINE`).
4. Tudo certo: `MARKET_ENABLED=true` e reinicie o pm2.
5. Front-end: copiar `docs/imgs_shop/` para os arquivos estáticos do mu-front.
