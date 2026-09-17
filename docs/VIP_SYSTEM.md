Este arquivo serve para descrever todas as particularidades do sistema de vip do servidor, e deve ser usado como base para criar as rotas relacionadas.

Vamos começar com o conceito, vip seria uma diferenciação de usuários dentro do servidor, que tem vantagens de acordo com os níveis.

O controle dessas vantagens é feito no gameserver do jogo, mas a compra do vip na loja e alguns pontos devem ser tratados aqui.

Teremos 4 tipos de contas, cada uma terá um valor:
0 - Free, usuário gratuito
1 - Vip, vantagens iniciais
2 - Super Vip, vantagens mais competitivas
3 - Mega Vip, força total em vantagens

O registro da conta vip na confirmação da venda deve ser feito na tabela MEMB_INFO, nas colunas Vip, VipStartDate e VipEndDate.

Os planos vip tem validade fixa de 30 dias.

Para o plano super vip, o cliente poderá ativar o autopick, coletando automaticamente ao cair no chão Jewel of Soul e Jewel of Bless.

Para o plano mega vip, será possível para o cliente selecionar os itens a serem pegos pelo autopick, com base em uma lista pré-configurada de possibilidades para seleção:

Uniria
Imp
Jewel of Chaos
Jewel of Soul 
Jewel of Bless
Jewel of Life
Box of kundun+1
Box of kundun+2
Box of kundun+3
Box of kundun+4
Box of kundun+5
Lochs feather

Os dados de quais itens foram selecionados para o autopick deverão ser salvos nessa tabela:

CREATE TABLE [dbo].[MEMB_AUTOPICK_ITEMS](
	[AccountID] [varchar](10) NOT NULL,
	[ItemGroup] [int] NOT NULL,
	[ItemIndex] [int] NOT NULL,
	[ItemLevel] [int] NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[AccountID] ASC,
	[ItemGroup] ASC,
	[ItemIndex] ASC,
	[ItemLevel] ASC
)WITH (PAD_INDEX  = OFF, STATISTICS_NORECOMPUTE  = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS  = ON, ALLOW_PAGE_LOCKS  = ON) ON [PRIMARY]
) ON [PRIMARY]

Lembrando que, super vip é fixo, e mega vip pode selecionar de uma lista.