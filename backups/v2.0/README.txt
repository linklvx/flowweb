FlowAI v2.0 Backup
==================
Date: 2026-05-21
Tag: v2.0

What's new since v1.31:
- Phase 1: PromptInput (Tiptap editor + /command system)
- Phase 2: ImageThumbnailBar (thumbnail bar + batch upload + drag sort)
- Phase 3: @mention system + clipboard paste
- Full nodeStore rewrite (AppNode nested structure)
- ReactFlow state sync hook (useReactFlowSync)
- Image inline chip NodeView
- Dual upload entry (floating button + bottom panel)

Database: 16 tables, 391.4KB
- user: 5, account: 3, session: 98
- canvasProject: 893, canvasNode: 84, canvasEdge: 57
- media: 95, template: 4, contentCard: 8
- aIModel: 6, modelResolution: 7, modelDuration: 3
- pricingRule: 12, userBalance: 3, announcement: 1
- nodeType: 3

Backup contents:
- database.json — full Prisma export
- schema.prisma — database schema
- .env.backup — environment config (sensitive — keep private)

Tests: 259 frontend + 199 backend = 458 total
