# v1.6 Backup

## Changes
- Canvas floating sidebar (NodePalette: absolute positioned, vertically centered)
- Project name in top-left corner (ProjectTitle component with inline editing)
- Editable project name defaults to "未命名项目" (Untitled Project)
- CanvasTopBar avatar dropdown (same as Navbar: first-letter circle, hover menu)
- Credits display: removes "积分" suffix, adds toLocaleString() formatting, white text
- Template upsert: saves by projectId (update existing, not create duplicate)
- TemplatePreview routing matches settings sidebar navigation
- Edge delete: × button on connection lines to remove edges
- ProjectName sync: editing in top-left updates save dialog
- "保存项目" (Save Project) instead of "保存为模板"
- Zoom range: 20%–300%

## Files
- schema.sql: Full database schema DDL
- schema.prisma: Prisma schema
- .env: API environment config
- api_data.json: Template and project data export
