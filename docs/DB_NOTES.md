# Notas sobre o banco (particularidades descobertas em produção)

Este arquivo registra coisas do banco real que não davam pra saber só
olhando o `CREATE TABLE` — descobertas testando contra produção. Ler antes
de escrever queries novas.

## Collation de `MEMB_INFO.memb___id` diferente do padrão do banco

`MEMB_INFO.memb___id` usa uma collation diferente da collation padrão do
banco (comum em bancos de MU migrados de servidor coreano). Isso quebra
`FOREIGN KEY` entre uma coluna nova (criada com a collation padrão) e
`memb___id`, com o erro:

```
Msg 1757 ... is not of same collation as referencing column ...
```

Solução aplicada em `migrations/0001_web_auth_tables.sql`: ler a
collation real de `memb___id` em tempo de execução (`sys.columns`) e usar
`COLLATE` explícito na coluna que referencia. Se criar uma nova tabela
com FK para `MEMB_INFO` ou `Character`, repita esse padrão em vez de
assumir a collation padrão do banco.

## Compatibility level não suporta `OFFSET ... FETCH NEXT`

O banco está em um **compatibility level anterior ao SQL Server 2012**
(provável herança de uma instalação SQL Server 2000/2005/2008 antiga).
A sintaxe de paginação `OFFSET @x ROWS FETCH NEXT @y ROWS ONLY` não é
reconhecida e dá:

```
Invalid usage of the option NEXT in the FETCH statement.
```

**Para qualquer paginação neste projeto, use `ROW_NUMBER() OVER (ORDER BY
...)` dentro de uma CTE, nunca `OFFSET/FETCH`.** Exemplo em
`src/db/auditLogRepository.js` (`findByAccount`). Isso vai valer também
para o ranking de personagens (Seção 4) e histórico de compras (Seção 5).

Não alterei o compatibility level do banco (`ALTER DATABASE ... SET
COMPATIBILITY_LEVEL`) porque isso afeta o comportamento de todo o banco,
inclusive para o gameserver — não é uma decisão para eu tomar sozinho.
Se você quiser subir o compatibility level em algum momento, isso
simplificaria essas queries, mas é uma mudança maior e fora do escopo de
"só a API" — só faço isso se você pedir explicitamente.
