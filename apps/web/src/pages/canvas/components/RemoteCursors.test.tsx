// apps/web/src/pages/canvas/components/RemoteCursors.test.tsx
// Y0b-3 T7（P-L）：消费面切 s.user.color——服务端注入字段直读（禁 fallback 双源）。
// 等价性锚的渲染半：注入 color==渲染值（迁移零色变的消费侧证据；算法半在 shared collab-identity-color.test）。
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { AwarenessBridge } from '@/collab/awareness';
import { RemoteCursors } from './RemoteCursors';
import { makeChild, seedCanvas, resetCanvasStores } from '@/test/fixtures/canvas';

function bridgeWithStates(states: Array<{ clientID: number; state: Record<string, unknown> }>): AwarenessBridge {
  const map = new Map(states.map((s) => [s.clientID, s.state]));
  const provider = {
    awareness: { clientID: 1, getStates: () => map },
    on: () => () => {},
    off: () => {},
  } as unknown as HocuspocusProvider;
  return new AwarenessBridge(provider);
}

describe('RemoteCursors（Y0b-3 T7 P-L：color 读注入字段）', () => {
  it('光标箭头与名牌渲染 s.user.color 注入字段（非 id 自算——改前红：渲染 id 自算值≠注入值）', () => {
    const bridge = bridgeWithStates([
      { clientID: 2, state: { user: { id: 'u2', name: '乙', color: '#ABCDEF' }, cursor: { x: 5, y: 6 } } },
    ]);
    const { container, getByText } = render(<RemoteCursors bridge={bridge} />);
    expect(getByText('乙')).toBeInTheDocument();
    const path = container.querySelector('path');
    expect(path?.getAttribute('fill')).toBe('#ABCDEF');
    expect(getByText('乙').style.background).toBe('rgb(171, 205, 239)');   // #ABCDEF jsdom 归一
  });
});

describe('RemoteCursors（Y0b-4 T12 E38：远端 selection 高亮层）', () => {
  afterEach(() => resetCanvasStores());

  it('远端 selection 存在时按节点框渲染高亮（几何=store 节点三档链；色=注入 user.color）', () => {
    seedCanvas([makeChild({ id: 'n1', position: { x: 30, y: 40 }, width: 100, height: 60 })]);
    const bridge = bridgeWithStates([
      { clientID: 2, state: { user: { id: 'u2', name: '乙', color: '#ABCDEF' }, selection: { nodeIds: ['n1'] } } },
    ]);
    const { container } = render(<RemoteCursors bridge={bridge} />);
    const box = container.querySelector('[data-testid="remote-selection-u2"]') as HTMLElement | null;
    expect(box).not.toBeNull();
    expect(box!.style.left).toBe('30px');
    expect(box!.style.top).toBe('40px');
    expect(box!.style.width).toBe('100px');
    expect(box!.style.height).toBe('60px');
    expect(box!.style.border).toContain('rgb(171, 205, 239)');   // #ABCDEF jsdom 归一——高亮色=注入字段单源
  });

  it('selection 缺失/空数组不渲染高亮层（无远端选区=零 overlay）', () => {
    seedCanvas([makeChild({ id: 'n1', position: { x: 30, y: 40 } })]);
    const bridge = bridgeWithStates([
      { clientID: 2, state: { user: { id: 'u2', name: '乙', color: '#ABCDEF' }, cursor: { x: 5, y: 6 } } },
      { clientID: 3, state: { user: { id: 'u3', name: '丙', color: '#ABCDEF' }, selection: { nodeIds: [] } } },
    ]);
    const { container } = render(<RemoteCursors bridge={bridge} />);
    expect(container.querySelector('[data-testid^="remote-selection-"]')).toBeNull();
  });
});
