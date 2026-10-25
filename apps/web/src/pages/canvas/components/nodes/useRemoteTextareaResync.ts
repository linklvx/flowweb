// apps/web/src/pages/canvas/components/nodes/useRemoteTextareaResync.ts
// Y1c T16 挂账#2（Q-I-3 强制裁定——T15 评审移交）：textarea 三域面板（audioGen/multiImageGen/
// textInput.prompt——Y.Text 域）useState mount-once 无远端重同步——远端编辑会被下一键击基于
// 陈旧基线的整串 patch 抹除。**裁定=(b) 非聚焦/非 IME 组段时订阅 doc 变更重同步本地 state**
//（裁定依据=成本/风险/卡边界：(a) 增量 patch 携带光标位需改 applyNodeDataPatch/T15 splice
// seam 协议面——T15 刚闭环的 G 门回归风险大且超 T16 卡边界；(b) 面板局部 effect 零 seam 变更
// 消灭挂账所指「mount-once 陈旧基线」主面；(c) defer=已知数据丢失缺陷挂账不处置——最弱。
// XmlFragment 域经 Tiptap+ySyncPlugin 结构性免此问题——本裁定只涉 textarea 三域。）
// 残余面如实登记：聚焦中并发键入仍以本地受控串整串 patch（splice seam 按 container 真值 diff
// ——远端插入会被本地基线覆盖；同 textarea 双端同时聚焦编辑=残留窗口，跨卡移交 T24 NORMALIZE/索引面评估）。
import { useEffect, type RefObject } from 'react';

/** Q-I-3(b) 重同步钩子：doc 投影值变化时（非聚焦∧非 IME 组段）同步本地受控 state。
 *  @param docValue  ns 投影域值（调用方 selector 订阅——远端+本地回环均触发）
 *  @param setLocal  本地 state setter（同值时 React 自行 bail——零多余渲染）
 *  @param textareaRef 受控 textarea 元素引用（聚焦/组段判定面） */
export function useRemoteTextareaResync(
  docValue: string,
  setLocal: (v: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): void {
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;                       // 无 textarea 场景（面板裁剪形态）零动作
    const composing = el.dataset.imeComposing === 'true';
    const focused = document.activeElement === el;
    if (!focused || composing) setLocal(docValue);   // 聚焦中（非组段）让位本地受控——残余面见头注
  }, [docValue, setLocal, textareaRef]);
}

/** IME 组段标记挂接（composition 事件→data-ime 标记——useRemoteTextareaResync 消费）。
 *  组件挂载 textarea 后调用一次（与既有业务 onChange 并存——纯 add/removeEventListener）。 */
export function attachImeCompositionMark(textareaRef: RefObject<HTMLTextAreaElement | null>): () => void {
  const el = textareaRef.current;
  if (!el) return () => {};
  const onStart = () => { el.dataset.imeComposing = 'true'; };
  const onEnd = () => { el.dataset.imeComposing = 'false'; };
  el.addEventListener('compositionstart', onStart);
  el.addEventListener('compositionend', onEnd);
  return () => {
    el.removeEventListener('compositionstart', onStart);
    el.removeEventListener('compositionend', onEnd);
  };
}
