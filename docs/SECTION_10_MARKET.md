# Seção 10 — Mercado (vitrine do baú `/mercado`) — fase 1

Plano completo e decisões: documento "Mural de Itens — Planejamento"
(Claude Docs). Resumo do que vale para o código:

- O jogador (Super VIP ou Mega VIP) usa `/mercado` no jogo, que troca para o
  baú da vitrine (`VaultID` 200) com a mesma procedure `MUDAR_BAU` do `/bau`.
  O personagem que usou o comando vira o **contato** da vitrine.
- Ele guarda os itens e troca de baú com `/bau`. Nesse momento a vitrine vai
  para `Extwarehouse` (`VaultID` 200), e **só daí** o site mostra.
- Sem preço e sem texto livre: o interessado chama o contato por whisper e a
  troca acontece no jogo. O site só lê; nunca grava em `warehouse` ou
  `Extwarehouse` por causa do mercado.

## O que foi feito (fase 1)

- **Loja**: `POST /shop/purchase` de `item:*`/`bundle:*` recusa com 409
  `WAREHOUSE_IS_SHOWCASE`, antes de debitar, quando o baú ativo é o do
  mercado (`warehouseService.assertNotShowcaseVault`). Sem isso o item
  comprado cairia na vitrine pública.
- **Decodificador de item** (`src/services/itemDecoder.js`): level, skill,
  luck, opção adicional (3 bits), excelentes, ancient (nome do set e bônus de
  stamina), Harmony (opção, level e valor), opção 380, durabilidade, serial,
  categoria e classes que usam. Bits conferidos no GameServer
  (`DSProtocol.cpp`, macros `DBI_*` e `CItem::IsExt*` em `zzzitem.cpp`).
- **Catálogo** (`src/data/itemCatalog.json`), gerado por
  `node scripts/generateItemCatalog.js` a partir de `docs/inv/Item.txt`,
  `ItemSetType.txt`, `ItemSetOption.txt` e `JewelOfHarmonyOption.txt` (cópias
  de `MuServer/Data/Item`). Rode de novo quando algum mudar.
- **Rotas** `GET /showcase/:name` (pública) e `GET /showcase/me` (logado) —
  ver `docs/API_REFERENCE.md`.
- **Itens ocultos** na vitrine (`showcaseController.HIDDEN_ITEMS`): Dark
  Horse e Dark Raven (dados do pet ficam em outra tabela, por serial) e o anel
  de GM. Lista editável no admin fica para a fase 3.
- Migration `migrations/0010_showcase.sql` — **não aplicada**:
  `WebShowcaseContact`, procedure `MERCADO_CONTATO` (chamada pelo GameServer)
  e `GRANT SELECT` para o `mu_api` em `WebShowcaseContact` e nas colunas de
  `Extwarehouse` usadas.

## Ordem de deploy

1. `migrations/0010_showcase.sql` no banco.
2. mu-api (rotas novas + bloqueio da loja).
3. GameServer com o `/mercado` (branch `feat/mercado-command`) e a seção 13
   de `FT/Comandos.txt` / `FT_CS/Comandos.txt`.
4. mu-front (aba "Vitrine" no perfil e "Minha vitrine" no painel).

Com o GameServer novo e sem a migration, o `/mercado` troca de baú mas só
registra no log que não conseguiu gravar o contato.

## Pendências / validar

1. Conferir no jogo os textos das opções de **asa** (`WING_EXCELLENT` em
   `itemDecoder.js`) e o nome de um item ancient e um Harmony contra o
   tooltip do client.
2. Fase 2: busca `/mercado` com indexador em memória.
3. Fase 3: denúncias, lista de ocultos editável, admin.
