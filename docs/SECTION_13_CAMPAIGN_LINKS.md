# Seção 13 — Links rastreáveis de campanha (2026-11-07)

> Status: **implementado** (API + front). Migration `0015` precisa ser
> aplicada manualmente **antes** do deploy da API.

## O que faz
Mede o tráfego e as contas trazidas por cada divulgador (influencer).

- O jogador acessa `https://mupro.vip/bonus/<codigo>` (ex.: `/bonus/influencerx`).
  O site abre normalmente (redireciona para `/`) e guarda o código no navegador.
- A **primeira visita de cada navegador a cada campanha** é gravada no banco
  com IP e user-agent.
- Ao criar conta em `/registro`, o código guardado vai junto, sem aparecer
  no formulário, e fica gravado em `WebAccountReferrals`.
- **Sem tela por enquanto:** campanhas são cadastradas e removidas, e os
  números consultados, direto no banco (consultas prontas abaixo).

## Decisões
- **Prefixo `/bonus/`**: nada de `/:codigo` na raiz, que conflitaria com as
  rotas do site e com a página 404.
- **Só valem campanhas cadastradas** em `WebCampaigns`. Um código
  desconhecido não é gravado em lugar nenhum, porque qualquer um poderia
  inventar URLs e encher as tabelas.
- **Código vale até a campanha ser removida do banco.** Não tem prazo de
  validade. Se a campanha for removida, visitas novas e registros com aquele
  código são ignorados, sem dar erro para o jogador.
- **Atribuição pelo último clique**: cada acesso a `/bonus/<codigo>`
  sobrescreve o código guardado no navegador. Quem passou por `/bonus/a` e
  depois por `/bonus/b` e criou conta é atribuído a `b`.
- **Atribuição em tabela própria (`WebAccountReferrals`)**, não em coluna da
  `MEMB_INFO`, que é tabela do gameserver.
- **Histórico sobrevive à remoção**: visitas e atribuições guardam o código
  como texto, **sem FK** para `WebCampaigns`. Remover a campanha encerra a
  captação mas mantém as métricas. ⚠ Recriar uma campanha com um código já
  usado mistura os números antigos com os novos; prefira um código novo.
- **Duplicatas**: dedup na gravação por `(código, VisitorId)`. O VisitorId é
  um UUID gerado no navegador e guardado no localStorage. O IP é gravado
  para análise, mas **não** bloqueia a gravação, porque celulares (CGNAT),
  lan houses e casas inteiras dividem o mesmo IP. O relatório mostra
  visitas únicas por VisitorId e por IP.
- **IP real**: depende de `TRUST_PROXY=1` em produção (nginx). Conferido
  em 2026-11-07 (`WebAuditLog` com IPs reais), nada a mudar no nginx.
- **Atribuição gravada depois do commit da conta**, não na mesma transação
  do `INSERT INTO MEMB_INFO`: assim nunca existe atribuição sem conta, e uma
  falha ao gravar a atribuição (ex.: migration ainda não aplicada) só gera
  log de erro, sem derrubar o registro do jogador.
- **Datas em UTC** (`SYSUTCDATETIME`, como as demais tabelas `Web*`).
  Horário de Brasília = UTC-3.

## Banco — migration `0015_campaign_links.sql`
Idempotente e aplicada manualmente, como as anteriores. Não mexe em
tabelas do gameserver.

Detalhes no próprio arquivo da migration. Resumo:

- `WebCampaigns (Code PK, Name, CreatedAt)`: `Code` com CHECK
  `[a-zA-Z0-9_-]`, 2 a 30 caracteres. A API normaliza para minúsculo.
- `WebCampaignVisits (Id, CampaignCode, VisitorId, Ip, UserAgent, CreatedAt)`:
  UNIQUE `(CampaignCode, VisitorId)` (dedup), índice `(CampaignCode, CreatedAt)`.
- `WebAccountReferrals (Username PK, CampaignCode, VisitId, Ip, CreatedAt)`:
  índice `(CampaignCode, CreatedAt)`.
- GRANTs para `mu_api`: só `SELECT` em `WebCampaigns`, `SELECT, INSERT` nas
  outras duas.

## API
### `POST /campaigns/visit` (público)
Body: `{ code, visitorId }` (`visitorId` = UUID). Rate limit por IP:
`RATE_LIMIT_CAMPAIGN_VISIT_MAX` por `RATE_LIMIT_CAMPAIGN_VISIT_WINDOW_MINUTES`
(padrão 10 por minuto).
- O código é normalizado para minúsculo e validado pelo padrão.
- Campanha inexistente → `404 CAMPAIGN_NOT_FOUND`.
- Existe → `INSERT` apenas se `(code, visitorId)` ainda não existir.
  Responde `200 { recorded: true|false }`.
- Código ou visitorId fora do padrão → `400 VALIDATION_ERROR`.

### `POST /auth/register` — campo novo opcional `ref`
Body: `{ username, password, email, ref?, visitorId? }`. Os dois campos são
opcionais no Joi, então clientes antigos continuam funcionando.
- Depois que a conta é criada, se `ref` corresponde a uma campanha
  cadastrada, grava `WebAccountReferrals` (`campaignsRepository.recordReferral`).
- `VisitId` = visita de `(ref, visitorId)`, se houver.
- `ref` inválido ou de campanha removida, ou erro ao gravar, é ignorado (só
  loga), e o registro responde 201 normalmente.
- Audit log `auth.register` de sucesso inclui `details.campaign` quando a
  atribuição foi gravada.

## Consultas (direto no banco)
```sql
-- cadastrar / remover campanha
INSERT INTO WebCampaigns (Code, Name) VALUES ('influencerx', N'Influencer X');
DELETE FROM WebCampaigns WHERE Code = 'influencerx';

-- visitas únicas por campanha (navegador e IP)
SELECT CampaignCode, COUNT(*) AS visitas, COUNT(DISTINCT Ip) AS ips
FROM WebCampaignVisits GROUP BY CampaignCode;

-- contas por campanha
SELECT CampaignCode, COUNT(*) AS contas
FROM WebAccountReferrals GROUP BY CampaignCode;

-- contas de uma campanha, com e-mail confirmado (COLLATE: DB_NOTES)
SELECT r.Username, r.CreatedAt, m.mail_chek
FROM WebAccountReferrals r
JOIN MEMB_INFO m ON m.memb___id = r.Username COLLATE DATABASE_DEFAULT
WHERE r.CampaignCode = 'influencerx';
```
Se o JOIN der erro de collation, troque `COLLATE DATABASE_DEFAULT` pela
collation de `memb___id` (`sys.columns`, como na migration 0001).

## Front (mu-front)
- `src/lib/campaign.ts`: código (`campaign-ref`) e visitorId
  (`campaign-visitor-id`) no localStorage, com try/catch, porque o storage
  pode falhar em aba anônima e em navegadores internos de app.
- `src/pages/CampaignLanding.tsx`, rota `/bonus/:code` (pública):
  1. chama `POST /campaigns/visit` em segundo plano;
  2. se a resposta for 200, ou se a API estiver fora do ar
     (`isServerUnavailable`), guarda o código, já que o registro revalida;
     com 404 ou 400 mantém o código anterior;
  3. `navigate('/', { replace: true })` na hora, sem esperar a resposta.
     O canonical acompanha a rota, então fica `/`.
- `Register.tsx`: envia `ref` e `visitorId` e limpa o `ref` depois do sucesso.
- `robots.txt`: `Disallow: /bonus/`.

## Privacidade (LGPD)
IP e user-agent são dados pessoais. Proposta: anonimizar `Ip` e `UserAgent`
de `WebCampaignVisits` com mais de 90 dias (job ou script manual), mantendo
as contagens. Citar a coleta na política e nas regras do site.

## Antifraude (se o divulgador for pago por conta)
Contar só contas com **e-mail confirmado**. Destacar no relatório campanhas
com muitas contas do mesmo IP ou em sequência rápida.

## Melhorias futuras
- **Tela de admin `/admin/campanhas`**: CRUD de campanhas e um funil por
  período (visitas únicas por VisitorId/IP, contas criadas, contas com
  e-mail confirmado, contas que compraram e receita Pix). Sem JOIN direto
  com `MEMB_INFO` por causa da collation (`docs/DB_NOTES.md`): usar duas
  queries ou `COLLATE` explícito. Ao criar pela tela, recusar códigos que já
  tenham histórico.
- **Painel do influencer**: página pública somente leitura com os números
  da própria campanha (visitas, contas, confirmadas, sem IP nem usernames),
  acessada por um token secreto por campanha (`WebCampaigns.ViewToken`,
  regenerável). Hoje os números são consultados só no banco.
- Aceitar também `?ref=` / `utm_source` em qualquer URL, para anúncios pagos.
- Vincular o código a um bônus real no jogo (ex.: gift code entregue ao
  confirmar o e-mail), aproveitando o sistema da Seção 10.
- Validade por campanha (`ExpiresAt`), se um dia for necessário.
