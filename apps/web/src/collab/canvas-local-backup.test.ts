// apps/web/src/collab/canvas-local-backup.test.ts
// Y0b-5 T6：导出双产物（.yjs 二进制可回灌+doc 反投影 JSON——禁 store 投影）+导入核
// （applyLocalBackup——applyUpdate 以 provider 为 origin 抑制 Update 帧回发+forceSync SS2 差分）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { QUOTA_DEFAULTS } from '@flowweb/shared';
import {
  buildLocalBackupPayload, exportLocalBackup, applyLocalBackup, LOCAL_BACKUP_MAX_BYTES,
} from './canvas-local-backup';
import { readCanvasFromDoc } from './ydocBuilder';

/** jsdom 无 URL.createObjectURL——静态方法注入 */
function stubBlobUrls(sink: Blob[]): { restore: () => void } {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (b: Blob) => { sink.push(b); return `blob:${sink.length}`; },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  return {
    restore: () => {
      delete (URL as any).createObjectURL;
      delete (URL as any).revokeObjectURL;
    },
  };
}

function docWithNode(key: string): Y.Doc {
  const d = new Y.Doc();
  d.transact(() => { d.getMap('nodes').set(key, new Y.Map([['id', key]])); });
  return d;
}

describe('Y0b-5 T6：buildLocalBackupPayload——doc 反投影（禁 store 投影）', () => {
  it('产物=encodeStateAsUpdate 二进制+readCanvasFromDoc 反投影 JSON（store 为空也可导出——hydration failed 空画布根修）', () => {
    const d = docWithNode('n-1');
    const payload = buildLocalBackupPayload(d);
    expect(payload).not.toBeNull();
    expect(payload!.yjs).toBeInstanceOf(Uint8Array);
    expect(payload!.yjs.byteLength).toBeGreaterThan(0);
    const json = JSON.parse(payload!.json);
    expect(json.nodes.map((n: { id: string }) => n.id)).toContain('n-1');
    expect(Array.isArray(json.edges)).toBe(true);
    expect(payload!.nodeCount).toBe(1);
  });
  it('null doc→null（无会话零产物——调用方 fail-soft）', () => {
    expect(buildLocalBackupPayload(null)).toBeNull();
  });
});

describe('Y0b-5 T6：exportLocalBackup——双产物下载', () => {
  let sink: Blob[] = [];
  let restore: () => void;
  beforeEach(() => { sink = []; restore = stubBlobUrls(sink).restore; });
  afterEach(() => restore());

  it('两文件下载：.yjs（octet-stream）+.json（json）；tag 标注入文件名（oldgen 标注旧代）', () => {
    const clicks: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') (el as HTMLAnchorElement).click = () => { clicks.push((el as HTMLAnchorElement).download); };
      return el;
    }) as typeof document.createElement);
    const art = exportLocalBackup(docWithNode('n-2'), { tag: 'oldgen9' });
    expect(art).not.toBeNull();
    expect(sink).toHaveLength(2);
    expect(sink[0].type).toBe('application/octet-stream');
    expect(sink[1].type).toBe('application/json');
    expect(clicks.filter((n) => n.endsWith('.yjs'))).toHaveLength(1);
    expect(clicks.filter((n) => n.endsWith('.json'))).toHaveLength(1);
    expect(clicks.every((n) => n.includes('oldgen9'))).toBe(true);
    vi.restoreAllMocks();
  });
  it('null doc→null 且零下载', () => {
    expect(exportLocalBackup(null)).toBeNull();
    expect(sink).toHaveLength(0);
  });
});

describe('Y0b-5 T6：applyLocalBackup——导入核（裁定 25⑷）', () => {
  /** provider 缝：只需 forceSync 可观测（origin 判定按引用相等） */
  const makeProvider = () => ({ forceSync: vi.fn() });

  it('≤上限：Y.applyUpdate(doc,bin,provider) 回灌+forceSync()（SS2 差分上行——≤2 次尝试收敛锚：1008 退避重试由 supervisor 全局承接,见实现注释）', () => {
    const doc = new Y.Doc();
    const provider = makeProvider();
    const src = docWithNode('n-3');
    const bin = Y.encodeStateAsUpdate(src);
    const r = applyLocalBackup(bin, { doc, provider });
    expect(r.ok).toBe(true);
    expect(doc.getMap('nodes').get('n-3')).toBeDefined();      // 已回灌（可回灌=导出双产物存在的意义）
    expect(provider.forceSync).toHaveBeenCalledTimes(1);
  });
  it('T18 ㉗：编码后 ~2MB 备份导入成功（上限判据=文档预算的证明——2MB<8MB maxDocBytes 恒过闸；文本 content 撑尺寸）', () => {
    const filler = 'x'.repeat(10 * 1024);                      // 10KB 文本/节点——Yjs 编码文本高效（几 KB 源文本×N 节点）
    const src = new Y.Doc();
    src.transact(() => {
      for (let i = 0; i < 210; i++) src.getMap('nodes').set(`n-${i}`, new Y.Map([['id', `n-${i}`], ['content', filler]]));
    });
    const bin = Y.encodeStateAsUpdate(src);
    expect(bin.byteLength).toBeGreaterThanOrEqual(2 * 1024 * 1024);        // 构造判据：编码后确 ≥2MB
    expect(bin.byteLength).toBeLessThanOrEqual(LOCAL_BACKUP_MAX_BYTES);   // 2MB<8MB——恒过 over-limit 闸
    const doc = new Y.Doc();
    const provider = makeProvider();
    const r = applyLocalBackup(bin, { doc, provider });
    expect(r.ok).toBe(true);
    expect(doc.getMap('nodes').size).toBe(210);                 // 全量回灌（不因尺寸截断/分批）
    expect(provider.forceSync).toHaveBeenCalledTimes(1);        // 上行走 SS2 差分单发（收敛语义同上用例——supervisor 全局承接）
  });
  it('origin=provider 语义锚：applyUpdate 第三参传 provider 实例——documentUpdateHandler esm:762 if(origin===this) return 抑制整 bin Update 帧回发（512KB 闸拒绝 3MB 备份=导出 8MB/导入 512KB 不对称的逃生断点）', () => {
    // 静态形态锁：实现必须以 provider 为 origin（防回退为默认 null=整帧上送）。
    // vitest jsdom 的 import.meta.url 非 file scheme——cwd=包根（vitest 约定）拼相对路径。
    const src = readFileSync(path.resolve(process.cwd(), 'src/collab/canvas-local-backup.ts'), 'utf8');
    expect(src).toMatch(/applyUpdate\(\s*deps\.doc\s*,\s*bin\s*,\s*deps\.provider\s*\)/);
  });
  it('超上限（>LOCAL_BACKUP_MAX_BYTES=QUOTA_DEFAULTS.maxDocBytes 同源）拒：over-limit+limitBytes/backupBytes 明示,不 apply 不 forceSync', () => {
    const doc = new Y.Doc();
    const provider = makeProvider();
    const big = new Uint8Array(QUOTA_DEFAULTS.maxDocBytes + 1);
    const r = applyLocalBackup(big, { doc, provider });
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'over-limit') {
      expect(r.limitBytes).toBe(QUOTA_DEFAULTS.maxDocBytes);
      expect(r.backupBytes).toBe(big.byteLength);
    } else expect.fail('应返回 over-limit');
    expect(doc.getMap('nodes').size).toBe(0);
    expect(provider.forceSync).not.toHaveBeenCalled();
  });
  it('LOCAL_BACKUP_MAX_BYTES 与 QUOTA_DEFAULTS.maxDocBytes 同源（T8 LOCAL_CACHE_MAX_DOC_BYTES 常量落地前以 QUOTA_DEFAULTS 表达）', () => {
    expect(LOCAL_BACKUP_MAX_BYTES).toBe(QUOTA_DEFAULTS.maxDocBytes);
  });
});
