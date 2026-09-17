-- Migration 0007 — remove a coluna CharacterName de WebItemRedemptions e
-- WebBundleRedemptions, NÃO aplicada automaticamente.
--
-- Resgate de item/pacote da loja passou a gravar no baú da conta
-- (warehouse), não mais na mochila de um personagem específico — ver
-- docs/SECTION_5_SHOP.md ("Adendo — Resgate migrado da mochila pro baú
-- da conta"). Desde então CharacterName vinha sempre NULL nessas duas
-- tabelas. Decisão do usuário (2026-09-17): não importa manter o
-- histórico de qual personagem estava selecionado nos resgates antigos
-- — remover a coluna de vez em vez de deixá-la morta.
--
-- NÃO mexe em Character nem em MEMB_INFO — só nas nossas próprias
-- tabelas (criadas pelas migrations 0002/0004). Mesma mecânica das
-- anteriores: idempotente, revise e aplique manualmente (SSMS/sqlcmd).
-- Isso é uma perda de dado permanente (o nome do personagem de resgates
-- antigos deixa de existir) — só rode depois de ter certeza que não
-- precisa mais disso.

-- ============================================================
-- 1. WebItemRedemptions
-- ============================================================
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_WebItemRedemptions_Character')
BEGIN
    ALTER TABLE [dbo].[WebItemRedemptions] DROP CONSTRAINT [FK_WebItemRedemptions_Character];
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.WebItemRedemptions') AND name = N'CharacterName')
BEGIN
    ALTER TABLE [dbo].[WebItemRedemptions] DROP COLUMN [CharacterName];
END
GO

-- ============================================================
-- 2. WebBundleRedemptions
-- ============================================================
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_WebBundleRedemptions_Character')
BEGIN
    ALTER TABLE [dbo].[WebBundleRedemptions] DROP CONSTRAINT [FK_WebBundleRedemptions_Character];
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.WebBundleRedemptions') AND name = N'CharacterName')
BEGIN
    ALTER TABLE [dbo].[WebBundleRedemptions] DROP COLUMN [CharacterName];
END
GO
