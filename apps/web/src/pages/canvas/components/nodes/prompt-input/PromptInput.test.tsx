import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';

// ========== Hoisted mock variables (accessible inside vi.mock factories) ==========

const {
  mockCreateRoot,
  capturedEditorConfig,
  mockGetTextResult,
  mockGetHTMLResult,
  mockEditor,
} = vi.hoisted(() => {
  const mockCreateRootFn = vi.fn(() => ({
    render: vi.fn(),
    unmount: vi.fn(),
  }));
  const capturedEditorConfigHolder: { current: Record<string, any> | null } = { current: null };
  const mockGetTextResultHolder: { current: string } = { current: 'test text' };
  const mockGetHTMLResultHolder: { current: string } = { current: '<p>test text</p>' };

  const mockEditorObj = {
    getText: vi.fn(() => mockGetTextResultHolder.current),
    getHTML: vi.fn(() => mockGetHTMLResultHolder.current),
    commands: {
      focus: vi.fn(),
      clearContent: vi.fn(),
    },
    chain: vi.fn(() => ({
      focus: vi.fn(() => ({
        deleteRange: vi.fn(() => ({ run: vi.fn() })),
        insertContent: vi.fn(() => ({ run: vi.fn() })),
      })),
    })),
    on: vi.fn(),
    off: vi.fn(),
    view: { dom: document.createElement('div') },
    isEditable: true,
    destroy: vi.fn(),
  };

  return {
    mockCreateRoot: mockCreateRootFn,
    capturedEditorConfig: capturedEditorConfigHolder,
    mockGetTextResult: mockGetTextResultHolder,
    mockGetHTMLResult: mockGetHTMLResultHolder,
    mockEditor: mockEditorObj,
  };
});

// ========== Mocks ==========

vi.mock('react-dom/client', () => ({
  createRoot: mockCreateRoot,
}));

vi.mock('./CommandMentionList', () => ({
  CommandMentionList: (props: any) => (
    <div data-testid="command-mention-list">
      {props.items?.map((item: any) => (
        <div key={item.id} data-command-id={item.id}>
          {item.name}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@tiptap/react', async (importOriginal) => {
  // Y1c T16：useEditor 两参形态（options ?? undefined + deps=[fragment]）——mock 同签名透传；
  // Extension 走真实现（ySyncHostExtension 经 @tiptap/react 重导出面——部分 mock importOriginal）
  const actual = await importOriginal<typeof import('@tiptap/react')>();
  return {
    ...actual,
    useEditor: vi.fn((config: any) => {
      capturedEditorConfig.current = config;
      return mockEditor;
    }),
    EditorContent: ({ editor: _editor }: any) => (
      <div data-testid="editor-content" role="textbox">
        Mock Editor
      </div>
    ),
  };
});

// ========== Dynamic imports (after mocks are set up) ==========

import PromptInput from './PromptInput';
import type { PromptInputRef } from './PromptInput';
import { _setIntentDocForTest } from '@/stores/canvasIntents';

// ========== Tests（Y1c T16 重写：prompt=XmlFragment 域——编辑器直绑 doc 容器，
// onChange/forceSync/debounce 链路删除；装置=真 Y.Doc 种子节点+prompt 容器） ==========

describe('PromptInput', () => {
  const defaultOnCommandSelect = vi.fn();
  const defaultOnGenerate = vi.fn();

  let doc: Y.Doc;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedEditorConfig.current = null;
    mockGetTextResult.current = 'test text';
    // 装置：真 doc + imageGen 节点（data.prompt=XmlFragment 容器——创建 seam 形态）
    doc = new Y.Doc();
    doc.transact(() => {
      const data = new Y.Map();
      data.set('prompt', new Y.XmlFragment());
      const n = new Y.Map();
      n.set('type', 'imageGen');
      n.set('data', data);
      doc.getMap('nodes').set('node-1', n);
    });
    _setIntentDocForTest(doc);
  });

  afterEach(() => {
    _setIntentDocForTest(null);
    vi.useRealTimers();
  });

  function renderPromptInput(props: Record<string, any> = {}): {
    ref: React.RefObject<PromptInputRef>;
    unmount: () => void;
  } {
    const ref = React.createRef<PromptInputRef>();
    const { unmount } = render(
      React.createElement(PromptInput, {
        nodeId: 'node-1',
        onCommandSelect: defaultOnCommandSelect,
        onGenerate: defaultOnGenerate,
        placeholder: '描述你想要的画面...',
        ...props,
        ref,
      }),
    );
    return { ref, unmount };
  }

  // ---- 1. renders EditorContent（容器在——编辑器直绑）----
  it('1. renders EditorContent with placeholder text visible', () => {
    renderPromptInput();
    const editorEl = screen.getByTestId('editor-content');
    expect(editorEl).toBeInTheDocument();
  });

  // ---- 1b. 容器缺失=只读回退（结构错误不掩盖——T15 容器规则）----
  it('1b. container missing renders read-only fallback html', () => {
    doc.transact(() => {
      ((doc.getMap('nodes').get('node-1') as Y.Map<any>).get('data') as Y.Map<any>).delete('prompt');
    });
    renderPromptInput({ fallbackHtml: '<p>legacy</p>' });
    expect(screen.getByText('legacy')).toBeInTheDocument();
    expect(screen.queryByTestId('editor-content')).toBeNull();
  });

  // ---- 3. disabled prop makes editor non-editable ----
  it('3. when disabled=true, editor should not be editable', () => {
    renderPromptInput({ disabled: true });
    expect(capturedEditorConfig.current!.editable).toBe(false);
  });

  // ---- 5. clear ----
  it('5. clear() calls editor.commands.clearContent()', () => {
    const { ref } = renderPromptInput();

    act(() => {
      ref.current!.clear();
    });

    expect(mockEditor.commands.clearContent).toHaveBeenCalled();
  });

  // ---- 6. Ctrl+Enter shortcut ----
  it('6. Ctrl+Enter triggers onGenerate callback', () => {
    const onGenerate = vi.fn();
    renderPromptInput({ onGenerate });

    fireEvent.keyDown(mockEditor.view.dom, {
      key: 'Enter',
      ctrlKey: true,
    });

    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  // ---- 7. no crash when onGenerate undefined ----
  it('7. does not crash when onGenerate is undefined (no Ctrl+Enter handler)', () => {
    renderPromptInput({ onGenerate: undefined });

    expect(() => {
      fireEvent.keyDown(mockEditor.view.dom, {
        key: 'Enter',
        ctrlKey: true,
      });
    }).not.toThrow();
  });

  // ---- 8. unmount destroys editor（ySync binding 随 editor 销毁链）----
  it('8. destroys editor on unmount', () => {
    const { unmount } = renderPromptInput();
    unmount();
    expect(mockEditor.destroy).toHaveBeenCalled();
  });

  // ---- 8b. getRichText 只读导出（fragment 单源——PromptValue 三出口基座）----
  it('8b. getRichText() derives from the bound fragment (read-only export)', () => {
    const frag = ((doc.getMap('nodes').get('node-1') as Y.Map<any>).get('data') as Y.Map<any>).get('prompt') as Y.XmlFragment;
    doc.transact(() => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, '你好');
      p.insert(0, [t]);
      frag.insert(0, [p]);
    });
    const { ref } = renderPromptInput();
    const rich = ref.current!.getRichText();
    expect(rich.text).toContain('你好');
    expect(rich.html).toContain('你好');
    expect(Array.isArray(rich.json)).toBe(true);
  });

  // ---- 默认 placeholder 文案（需求 3）----
  it('N1. 默认 placeholder 为新文案（不传 placeholder prop）', () => {
    // renderPromptInput 显式传 placeholder 后 ...props 展开——传 undefined 覆盖之，
    // 组件解构默认值对 undefined 生效 → 命中默认文案路径
    renderPromptInput({ placeholder: undefined });
    // capturedEditorConfig 是 vi.hoisted holder：.current 即 useEditor config（一层 current，勿多包）
    const exts = capturedEditorConfig.current!.extensions as any[];
    const ph = exts.find((e: any) => e?.name === 'placeholder');
    expect(ph?.options?.placeholder).toBe('描述你想要生成的画面内容，@引用素材');
  });

  // ---- 输入区 cursor（需求 1）----
  it('N2. PromptInput.css：.prompt-editor 有 cursor:text 且 .command-chip 有 cursor:default', () => {
    const css = readFileSync(path.resolve(__dirname, 'PromptInput.css'), 'utf-8');
    // 全文兜底 + 锚定切片双保险（.prompt-editor 在文件中出现 3 次，切片锚第一块 L64）
    expect(css).toContain('cursor: text');
    const editorBlock = css.slice(css.indexOf('.prompt-editor {'), css.indexOf('.prompt-editor p'));
    expect(editorBlock).toContain('cursor: text');
    const chipBlock = css.slice(css.indexOf('.command-chip'), css.indexOf('/* ImageThumbnailBar'));
    expect(chipBlock).toContain('cursor: default');
  });
});
