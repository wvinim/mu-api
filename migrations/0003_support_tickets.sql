-- Migration 0003 — tickets de suporte, NÃO aplicada automaticamente.
-- Mesma mecânica das migrations anteriores: idempotente, COLLATE dinâmico
-- nas colunas que referenciam MEMB_INFO(memb___id).

-- ============================================================
-- 1. Tickets
-- ============================================================
IF OBJECT_ID(N'dbo.WebSupportTickets', N'U') IS NULL
BEGIN
    DECLARE @collation1 sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.MEMB_INFO') AND name = N'memb___id'
    );
    DECLARE @sql1 NVARCHAR(MAX) = N'
    CREATE TABLE [dbo].[WebSupportTickets] (
        [Id]        INT IDENTITY(1,1) NOT NULL,
        [AccountId] VARCHAR(10) COLLATE ' + @collation1 + N' NOT NULL,
        [Subject]   VARCHAR(200)  NOT NULL,
        [Status]    VARCHAR(20)   NOT NULL DEFAULT ''open'',
        [CreatedAt] DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        [UpdatedAt] DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebSupportTickets] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [CK_WebSupportTickets_Status] CHECK ([Status] IN (''open'', ''closed'')),
        CONSTRAINT [FK_WebSupportTickets_MEMB_INFO] FOREIGN KEY ([AccountId])
            REFERENCES [dbo].[MEMB_INFO] ([memb___id])
    );';
    EXEC sp_executesql @sql1;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebSupportTickets_AccountId' AND object_id = OBJECT_ID(N'dbo.WebSupportTickets'))
    CREATE INDEX [IX_WebSupportTickets_AccountId] ON [dbo].[WebSupportTickets] ([AccountId]);
GO

-- ============================================================
-- 2. Respostas (a mensagem inicial do ticket também vira a 1ª resposta)
-- ============================================================
IF OBJECT_ID(N'dbo.WebSupportReplies', N'U') IS NULL
BEGIN
    DECLARE @collation2 sysname = (
        SELECT collation_name FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.MEMB_INFO') AND name = N'memb___id'
    );
    DECLARE @sql2 NVARCHAR(MAX) = N'
    CREATE TABLE [dbo].[WebSupportReplies] (
        [Id]               BIGINT IDENTITY(1,1) NOT NULL,
        [TicketId]         INT           NOT NULL,
        [AuthorAccountId]  VARCHAR(10) COLLATE ' + @collation2 + N' NOT NULL,
        [Message]          NVARCHAR(MAX) NOT NULL,
        [CreatedAt]        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_WebSupportReplies] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [FK_WebSupportReplies_WebSupportTickets] FOREIGN KEY ([TicketId])
            REFERENCES [dbo].[WebSupportTickets] ([Id]),
        CONSTRAINT [FK_WebSupportReplies_MEMB_INFO] FOREIGN KEY ([AuthorAccountId])
            REFERENCES [dbo].[MEMB_INFO] ([memb___id])
    );';
    EXEC sp_executesql @sql2;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WebSupportReplies_TicketId' AND object_id = OBJECT_ID(N'dbo.WebSupportReplies'))
    CREATE INDEX [IX_WebSupportReplies_TicketId] ON [dbo].[WebSupportReplies] ([TicketId]);
GO
