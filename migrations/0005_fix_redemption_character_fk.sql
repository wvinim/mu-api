-- Migration 0005 — corrige FK de WebItemRedemptions/WebBundleRedemptions
-- para Character(Name), NÃO aplicada automaticamente.
--
-- BUG REAL EM PRODUÇÃO: as FKs criadas nas migrations 0002 e 0004 não
-- especificam ON DELETE, então o SQL Server usa o padrão NO ACTION. Ao
-- deletar um personagem que já resgatou algo na loja, o DELETE bate na
-- constraint (erro 547) e é rejeitado. O gameserver em C++ não trata esse
-- erro de SQL corretamente e crasha. Personagens sem nenhum resgate
-- deletam normalmente — é por isso que o bug só aparece depois de usar a
-- loja.
--
-- Correção: ON DELETE SET NULL. O personagem pode ser deletado normalmente
-- e o histórico de resgate (conta, item/pacote, preço, data) continua
-- existindo para auditoria financeira — só o nome do personagem fica NULL.
-- Por isso CharacterName precisa passar a aceitar NULL nas duas tabelas.
--
-- Mesma mecânica das migrations anteriores: idempotente, revise e aplique
-- manualmente (SSMS/sqlcmd). Se existir staging/cópia, teste lá primeiro
-- — em especial, crie um resgate de teste e depois delete o personagem de
-- teste para confirmar que o DELETE não trava mais.

-- ============================================================
-- 1. WebItemRedemptions.CharacterName
-- ============================================================
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_WebItemRedemptions_Character')
BEGIN
    ALTER TABLE [dbo].[WebItemRedemptions] DROP CONSTRAINT [FK_WebItemRedemptions_Character];
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.WebItemRedemptions') AND name = N'CharacterName' AND is_nullable = 0
)
BEGIN
    DECLARE @collationChar1 sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.Character') AND name = N'Name'
    );
    DECLARE @sql1 NVARCHAR(MAX) = N'
    ALTER TABLE [dbo].[WebItemRedemptions]
    ALTER COLUMN [CharacterName] VARCHAR(10) COLLATE ' + @collationChar1 + N' NULL;';
    EXEC sp_executesql @sql1;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_WebItemRedemptions_Character')
BEGIN
    ALTER TABLE [dbo].[WebItemRedemptions]
    ADD CONSTRAINT [FK_WebItemRedemptions_Character] FOREIGN KEY ([CharacterName])
        REFERENCES [dbo].[Character] ([Name]) ON DELETE SET NULL;
END
GO

-- ============================================================
-- 2. WebBundleRedemptions.CharacterName
-- ============================================================
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_WebBundleRedemptions_Character')
BEGIN
    ALTER TABLE [dbo].[WebBundleRedemptions] DROP CONSTRAINT [FK_WebBundleRedemptions_Character];
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.WebBundleRedemptions') AND name = N'CharacterName' AND is_nullable = 0
)
BEGIN
    DECLARE @collationChar2 sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.Character') AND name = N'Name'
    );
    DECLARE @sql2 NVARCHAR(MAX) = N'
    ALTER TABLE [dbo].[WebBundleRedemptions]
    ALTER COLUMN [CharacterName] VARCHAR(10) COLLATE ' + @collationChar2 + N' NULL;';
    EXEC sp_executesql @sql2;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_WebBundleRedemptions_Character')
BEGIN
    ALTER TABLE [dbo].[WebBundleRedemptions]
    ADD CONSTRAINT [FK_WebBundleRedemptions_Character] FOREIGN KEY ([CharacterName])
        REFERENCES [dbo].[Character] ([Name]) ON DELETE SET NULL;
END
GO
