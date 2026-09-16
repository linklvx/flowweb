import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProcessSnapshot } from '../ProcessSnapshot';
import type { ProcessSnapshotData } from '@flowweb/shared';

const snap: ProcessSnapshotData = {
  workId: 'w1', title: 't',
  nodes: [
    { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '一只猫在窗台上' } },
    { id: 'n2', type: 'imageGen', position: { x: 300, y: 0 }, data: { prompt: 'cat', thumbnailUrl: '/flowai/th.webp' } },
    { id: 'g1', type: 'group', position: { x: 500, y: 0 }, data: { groupType: 'storyboard', cells: ['n3'] } },
    { id: 'n3', type: 'videoGen', position: { x: 520, y: 20 }, parentId: 'g1', data: { label: '导出 1' } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
};

describe('ProcessSnapshot（spec §5.3 红线）', () => {
  it('每个节点渲染默认 Handle×2：.react-flow__handle 数 === nodes×2', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles.length).toBe(snap.nodes.length * 2);   // 缺 Handle → 边全丢（isNodeInitialized 早退静默丢弃、不报 error008——spec §5.3 第八轮措辞，plan 第九轮对齐）
  });

  it('纯文本渲染：content 含 XSS 载荷时以字面文本显示、不产生 img（第八轮：真喂载荷——旧夹具无任何 HTML 是恒真断言，"XSS 夹具"名不副实）', () => {
    const withXssPayload = { ...snap, nodes: [{ ...snap.nodes[0], data: { content: '<img src=x onerror=alert(1)>一只猫在窗台上' } }] };
    const { container, getByText } = render(<ProcessSnapshot snapshot={withXssPayload} />);
    expect(getByText('<img src=x onerror=alert(1)>一只猫在窗台上')).toBeInTheDocument(); // 字面文本整串（React 文本节点自动转义）
    expect(container.querySelectorAll('img')).toHaveLength(0); // 该 fixture 无 thumbnailUrl——出现任何 img 即 dangerouslySetInnerHTML 侧漏
  });

  it('缩略图展示：thumbnailUrl 渲染为 img', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    expect(container.querySelector('img[src="/flowai/th.webp"]')).toBeTruthy();
  });

  it('组框：groupType=storyboard 渲染分镜样式（data-group-type 标记）', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    expect(container.querySelector('[data-group-type="storyboard"]')).toBeTruthy();
  });
});
