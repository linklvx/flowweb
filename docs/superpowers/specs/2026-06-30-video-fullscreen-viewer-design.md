# Video Fullscreen Viewer Design

## Overview

Wire the maximize button in VideoNodeToolbar to open a fullscreen video overlay using `BaseFullscreenModal`, following the same trigger pattern as ImageNodeToolbar → ImageFullscreenViewer.

## Design

- **Trigger**: `VideoNodeToolbar` receives `onFullscreen` prop, wired to the expand button
- **State**: `VideoGenNode` manages `fullscreenOpen` + `fullscreenUrl` (same pattern as ImageGenNode)
- **Viewer**: `VideoFullscreenViewer` — a thin wrapper around `BaseFullscreenModal` rendering `<video controls>`
- **Close**: ESC key, backdrop click, close button — all handled by `BaseFullscreenModal`

## Component Tree

```
VideoGenNode.tsx
  ├── VideoNodeToolbar (onFullscreen prop added)
  ├── fullscreenOpen / fullscreenUrl state
  ├── handleOpenFullscreen / handleCloseFullscreen
  └── VideoFullscreenViewer (NEW)
        └── BaseFullscreenModal
              └── <video controls>
```

## Files

| File | Action |
|------|--------|
| `apps/web/src/pages/canvas/components/nodes/VideoFullscreenViewer.tsx` | NEW |
| `apps/web/src/pages/canvas/components/nodes/VideoFullscreenViewer.test.tsx` | NEW |
| `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx` | MODIFY — add `onFullscreen` prop |
| `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx` | MODIFY — manage state, render viewer |
