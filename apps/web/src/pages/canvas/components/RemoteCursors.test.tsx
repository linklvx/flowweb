// apps/web/src/pages/canvas/components/RemoteCursors.test.tsx
// Y0b-3 T7（P-L）：消费面切 s.user.color——服务端注入字段直读（禁 fallback 双源）。
// 等价性锚的渲染半：注入 color==渲染值（迁移零色变的消费侧证据；算法半在 shared collab-identity-color.test）。
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { AwarenessBridge } from '@/collab/awareness';
import { RemoteCursors } from './RemoteCursors';

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
