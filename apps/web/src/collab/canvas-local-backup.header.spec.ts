// apps/web/src/collab/canvas-local-backup.header.spec.ts
// Y5 T6b（P4）：备份 .yjs 帧头——ASCII 'FWYJS1\n' + uint32 大端 JSON 长度 + UTF-8
// { magic:'flowweb-yjs', schemaVersion, historyToken } + 原始 update。
// 导入校验：头缺失/magic 不符/字段与当前库不一致 ⇒ 拒绝（不 applyUpdate）；旧无头字节不兼容（无垫片）。
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import {
  encodeYjsFrame, decodeYjsFrame, applyLocalBackup,
} from './canvas-local-backup';

const PREFIX = 'FWYJS1\n';
const HEADER_BASE = PREFIX.length + 4;   // 11

const textDoc = (v: string): Y.Doc => {
  const d = new Y.Doc();
  d.getText('t').insert(0, v);
  return d;
};

const makeProvider = () => ({ forceSync: vi.fn() });

/** 帧头 JSON 长度（大端 uint32——测试独立复读，不复用实现内部常量） */
const readHeaderLength = (framed: Uint8Array): number =>
  new DataView(framed.buffer, framed.byteOffset + PREFIX.length, 4).getUint32(0, false);

describe('Y5 T6b：encodeYjsFrame/decodeYjsFrame——版本+纪元帧头', () => {
  it('编码=FWYJS1\\n+uint32 大端 JSON 长度+JSON 头+原始 update；decode 往返 header 与 update 逐字节一致', () => {
    const update = Y.encodeStateAsUpdate(textDoc('hello'));
    const header = { schemaVersion: 6, historyToken: 'h-2026-11-24-a' };
    const framed = encodeYjsFrame(update, header);

    // ① ASCII 前缀 7 字节
    expect(new TextDecoder().decode(framed.subarray(0, PREFIX.length))).toBe(PREFIX);
    // ② 其后 uint32 大端=JSON 头 UTF-8 字节长度
    const jsonLen = readHeaderLength(framed);
    expect(framed.byteLength).toBe(HEADER_BASE + jsonLen + update.byteLength);
    const jsonHeader = JSON.parse(new TextDecoder().decode(framed.subarray(HEADER_BASE, HEADER_BASE + jsonLen)));
    expect(jsonHeader).toEqual({ magic: 'flowweb-yjs', schemaVersion: 6, historyToken: 'h-2026-11-24-a' });
    // ③ 帧尾=原始 update；decode 往返逐字节一致
    const decoded = decodeYjsFrame(framed);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.header).toEqual({ magic: 'flowweb-yjs', schemaVersion: 6, historyToken: 'h-2026-11-24-a' });
      expect(decoded.update).toEqual(update);
    }
  });

  it('decode 拒绝：空/短缓冲→no-header；magic 字节不符→bad-magic；声明长度超出缓冲→bad-length；非 JSON 体→bad-json', () => {
    const update = Y.encodeStateAsUpdate(textDoc('x'));

    expect(decodeYjsFrame(new Uint8Array(0))).toEqual({ ok: false, reason: 'no-header' });
    expect(decodeYjsFrame(new Uint8Array([70, 87, 89, 74, 83]))).toEqual({ ok: false, reason: 'no-header' });   // 'FWYJS' 截断

    const framed = encodeYjsFrame(update, { schemaVersion: 6, historyToken: '' });
    const badMagic = framed.slice();
    badMagic[0] = 0x00;
    expect(decodeYjsFrame(badMagic)).toEqual({ ok: false, reason: 'bad-magic' });

    const badLength = framed.slice();
    new DataView(badLength.buffer, badLength.byteOffset + PREFIX.length, 4).setUint32(0, badLength.byteLength + 10, false);
    expect(decodeYjsFrame(badLength)).toEqual({ ok: false, reason: 'bad-length' });

    // 前缀+合法长度但体不是 JSON
    const body = new TextEncoder().encode('not json');
    const nonJson = new Uint8Array(HEADER_BASE + body.byteLength);
    nonJson.set(new TextEncoder().encode(PREFIX), 0);
    new DataView(nonJson.buffer).setUint32(PREFIX.length, body.byteLength, false);
    nonJson.set(body, HEADER_BASE);
    expect(decodeYjsFrame(nonJson)).toEqual({ ok: false, reason: 'bad-json' });
  });
});

describe('Y5 T6b：applyLocalBackup——expected 校验（不一致拒绝、不 applyUpdate）', () => {
  const expected = { schemaVersion: 6, historyToken: 'h-epoch-1' };

  it('头与当前库一致→{ok:true}：真实 Yjs 内容回灌+forceSync', () => {
    const src = textDoc('hello-backup');
    const framed = encodeYjsFrame(Y.encodeStateAsUpdate(src), expected);
    const doc = new Y.Doc();
    const provider = makeProvider();
    const r = applyLocalBackup(framed, { doc, provider }, expected);
    expect(r).toEqual({ ok: true });
    expect(doc.getText('t').toString()).toBe('hello-backup');
    expect(provider.forceSync).toHaveBeenCalledTimes(1);
  });

  it('schemaVersion 不一致→schema-mismatch 拒绝、doc 内容不变、不 forceSync', () => {
    const framed = encodeYjsFrame(Y.encodeStateAsUpdate(textDoc('bad-schema')), { schemaVersion: expected.schemaVersion + 1, historyToken: expected.historyToken });
    const doc = new Y.Doc();
    const provider = makeProvider();
    const r = applyLocalBackup(framed, { doc, provider }, expected);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('schema-mismatch');
    expect(doc.getText('t').toString()).toBe('');
    expect(provider.forceSync).not.toHaveBeenCalled();
  });

  it('historyToken 不一致→epoch-mismatch 拒绝、doc 内容不变、不 forceSync', () => {
    const framed = encodeYjsFrame(Y.encodeStateAsUpdate(textDoc('bad-epoch')), { schemaVersion: expected.schemaVersion, historyToken: 'h-other-epoch' });
    const doc = new Y.Doc();
    const provider = makeProvider();
    const r = applyLocalBackup(framed, { doc, provider }, expected);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('epoch-mismatch');
    expect(doc.getText('t').toString()).toBe('');
    expect(provider.forceSync).not.toHaveBeenCalled();
  });

  it('无头旧格式字节（裸 encodeStateAsUpdate）→拒绝、doc 不变（旧导出不兼容——无垫片）', () => {
    const bare = Y.encodeStateAsUpdate(textDoc('legacy'));
    const doc = new Y.Doc();
    const provider = makeProvider();
    const r = applyLocalBackup(bare, { doc, provider }, expected);
    expect(r.ok).toBe(false);
    // 裸 update 首字节≠'FWYJS1\n'：≥11B=bad-magic，更短=no-header——两者皆拒（无旧格式垫片）
    if (!r.ok) expect(['no-header', 'bad-magic']).toContain(r.reason);
    expect(doc.getText('t').toString()).toBe('');
    expect(provider.forceSync).not.toHaveBeenCalled();
  });
});
