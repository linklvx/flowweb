<!-- doc-status: historical | verified_at: n/a -->
# Video Node Floating Toolbar Design

## Overview

Replace the floating upload button above video nodes (when a video is loaded) with a multi-button floating toolbar, following the same pattern as the image node toolbar but using a single-row inline layout.

## Design Decisions

- **Rendering**: Inline CSS absolute positioning (child of node div). Simpler than portal-based rendering, appropriate for a single-row toolbar.
- **Display trigger**: `selected && hasVideo` — same logic as image node: upload button when empty, toolbar when loaded.
- **Layout**: Single row with button groups, divider, and icon-only buttons. Reference: user-provided HTML/CSS.
- **Styling**: CSS variables from the project (`--canvas-controls-bg`, `--canvas-controls-border`, `--canvas-controls-text`, `--canvas-controls-hover`) + backdrop blur + box shadow.
- **Icons**: Original inline SVG components. No Iconify/Lucide imports (copyright-safe). Simple geometric shapes where possible.
- **No functional logic**: Buttons are UI placeholders only. No click handlers, no dropdown menus.

## Component Tree

```
VideoGenNode.tsx
  ├── upload button (selected && !hasVideo)        // existing, unchanged
  └── VideoNodeToolbar (selected && hasVideo)       // NEW
        ├── 剪辑 (Clip) button
        ├── 裁剪 (Crop) button
        ├── 高清 (HD) button
        ├── 解析 (Parse) button
        ├── 智能去字幕 (Smart Remove Subtitles) + dropdown arrow
        ├── 音频分离 (Audio Separation) + dropdown arrow
        ├── Divider
        ├── Download button (icon only)
        └── Expand button (icon only)
```

## Files

| File | Action |
|------|--------|
| `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx` | NEW — toolbar component |
| `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx` | MODIFY — conditionally render toolbar |
| `apps/web/src/index.css` | MODIFY — add `--canvas-shadow-dropdown` if needed |

## Styling Reference

Key CSS from reference (adapted to project conventions):
- Container: `absolute left-1/2 -translate-x-1/2`, `bottom: calc(100% + 32px)`, `z-index: 20`
- Toolbar body: `flex items-center justify-center gap-1`, `padding: 4px`, `border-radius: 12px`, `border: 0.5px solid var(--canvas-controls-border)`, `background: var(--canvas-controls-bg)`, `box-shadow: var(--canvas-shadow-dropdown)`, `backdrop-filter: blur(16px)`
- Buttons: `flex h-8 items-center justify-center gap-1 rounded-lg px-3 py-2 text-[13px]`, `color: var(--canvas-controls-text)`, hover: `background: var(--canvas-controls-hover)`
- Icon-only buttons: `h-8 w-8 min-w-8 shrink-0`
- Divider: `mx-1 h-5`, `border-left: 0.5px solid var(--canvas-controls-border)`
