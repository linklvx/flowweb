import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';

// ========== Hoisted mock variables (accessible inside vi.mock factories) ==========

const {
  mockCreateRoot,
  mockPopupRender,
  mockUnmount,
  capturedEditorConfig,
  mockGetTextResult,
  mockGetHTMLResult,
  mockEditor,
} = vi.hoisted(() => {
  const mockCreateRootFn = vi.fn(() => ({
    render: vi.fn(),
    unmount: vi.fn(),
  }));
  const mockPopupRenderFn = vi.fn();
  const mockUnmountFn = vi.fn();
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
    mockPopupRender: mockPopupRenderFn,
    mockUnmount: mockUnmountFn,
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

vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn((config: any) => {
    capturedEditorConfig.current = config;
    return mockEditor;
  }),
  EditorContent: ({ editor: _editor }: any) => (
    <div data-testid="editor-content" role="textbox">
      Mock Editor
    </div>
  ),
}));

// ========== Dynamic imports (after mocks are set up) ==========

import PromptInput from './PromptInput';
import type { PromptInputRef } from './PromptInput';
import type { PromptValue } from './types';

// ========== Tests ==========

describe('PromptInput', () => {
  const defaultOnChange = vi.fn();
  const defaultOnCommandSelect = vi.fn();
  const defaultOnGenerate = vi.fn();
  const defaultValue: PromptValue = {
    text: '',
    html: '',
    referencedImageIds: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedEditorConfig.current = null;
    mockGetTextResult.current = 'test text';
  });

  afterEach(() => {
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
        value: defaultValue,
        onChange: defaultOnChange,
        onCommandSelect: defaultOnCommandSelect,
        onGenerate: defaultOnGenerate,
        placeholder: '描述你想要的画面...',
        ...props,
        ref,
      }),
    );
    return { ref, unmount };
  }

  // ---- 1. renders EditorContent ----
  it('1. renders EditorContent with placeholder text visible', () => {
    renderPromptInput();
    const editorEl = screen.getByTestId('editor-content');
    expect(editorEl).toBeInTheDocument();
  });

  // ---- 2. typing triggers debounced onChange ----
  it('2. typing triggers debounced onChange with updated text', () => {
    vi.useFakeTimers();
    renderPromptInput();

    // useEditor must have been called with onUpdate
    expect(capturedEditorConfig.current).not.toBeNull();
    expect(capturedEditorConfig.current!.onUpdate).toBeDefined();

    mockGetTextResult.current = 'hello world';
    mockGetHTMLResult.current = '<p>hello world</p>';

    // Simulate Tiptap's onUpdate callback
    act(() => {
      capturedEditorConfig.current!.onUpdate({ editor: mockEditor } as any);
    });

    // Debounce timer has NOT fired yet — onChange not called
    expect(defaultOnChange).not.toHaveBeenCalled();

    // Advance past debounceMs (300ms)
    vi.advanceTimersByTime(300);

    // Now onChange should be called with preserved value fields + updated text
    expect(defaultOnChange).toHaveBeenCalledTimes(1);
    expect(defaultOnChange).toHaveBeenCalledWith({
      text: 'hello world',
      html: '<p>hello world</p>',
      referencedImageIds: [],
    });

    vi.useRealTimers();
  });

  // ---- 3. disabled prop makes editor non-editable ----
  it('3. when disabled=true, editor should not be editable', () => {
    renderPromptInput({ disabled: true });
    expect(capturedEditorConfig.current!.editable).toBe(false);
  });

  // ---- 4. forceSync flush ----
  it('4. forceSync() flushes pending debounce and calls onChange immediately', () => {
    vi.useFakeTimers();
    const { ref } = renderPromptInput();

    mockGetTextResult.current = 'forced text';
    mockGetHTMLResult.current = '<p>forced text</p>';

    // Trigger debounced onUpdate
    act(() => {
      capturedEditorConfig.current!.onUpdate({ editor: mockEditor } as any);
    });

    // Call forceSync via ref — debounce should be flushed
    act(() => {
      ref.current!.forceSync();
    });

    // onChange must be called synchronously (not after debounce delay)
    expect(defaultOnChange).toHaveBeenCalledWith({
      text: 'forced text',
      html: '<p>forced text</p>',
      referencedImageIds: [],
    });

    vi.useRealTimers();
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

  // ---- 8. unmount flushes pending debounced writes ----
  it('8. flushes pending debounced onChange on unmount so content is not lost', () => {
    vi.useFakeTimers();
    const { unmount } = renderPromptInput();

    mockGetTextResult.current = 'typed before deselection';
    mockGetHTMLResult.current = '<p>typed before deselection</p>';

    // Simulate user typing — triggers debounced onUpdate
    act(() => {
      capturedEditorConfig.current!.onUpdate({ editor: mockEditor } as any);
    });

    // onChange NOT yet called (debounce pending)
    expect(defaultOnChange).not.toHaveBeenCalled();

    // Unmount (simulates panel hiding when node deselected)
    unmount();

    // After unmount, onChange should have been called with the latest text
    expect(defaultOnChange).toHaveBeenCalledWith({
      text: 'typed before deselection',
      html: '<p>typed before deselection</p>',
      referencedImageIds: [],
    });

    // Editor should be destroyed
    expect(mockEditor.destroy).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
