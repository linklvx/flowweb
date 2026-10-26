// apps/web/src/stores/runtimeFeedWiring.spec.ts
// Y1c T22 收口批 C-1：runtime feed 生产接线断言（红=修前 runtimeFeedFetchers 生产恒 null——
// 全仓零赋值，spec 注入缝掩盖生产断链：服务端旧通道已拆而新通道客户端零消费者）
// +心跳同形载荷解析（{type:'heartbeat',latestFeedSeq} 修前在 stateless handler 被静默丢弃
// =「漏通知仅心跳追平」语料断裂——parseFeedHintPayload 两形同路）。
import { describe, it, expect } from 'vitest';
import { runtimeFeedFetchers, resetRuntimeFeed } from './runtimeStore';
import { parseFeedHintPayload, wireRuntimeFeedProductionFetchers } from './canvasCollabRuntime';

describe('Y1c T22 收口批 C-1：生产接线（snapshot/events 两 fetcher——armSession 会话起点注入）', () => {
  it('wireRuntimeFeedProductionFetchers：注入前恒 null（红基线实录）→注入后两 fetcher 生产在位', () => {
    runtimeFeedFetchers.snapshot = null;
    runtimeFeedFetchers.events = null;
    expect(runtimeFeedFetchers.snapshot).toBeNull();   // 修前生产态（红证据——恒 null 断链）
    expect(runtimeFeedFetchers.events).toBeNull();
    wireRuntimeFeedProductionFetchers();
    expect(runtimeFeedFetchers.snapshot).not.toBeNull();
    expect(runtimeFeedFetchers.events).not.toBeNull();
    resetRuntimeFeed();
  });
  it('parseFeedHintPayload：feed-hint/heartbeat 两形同路（C-1 心跳放宽档）+非本协议载荷 null 透传', () => {
    expect(parseFeedHintPayload('{"type":"feed-hint","latestFeedSeq":"7"}')).toBe('7');
    expect(parseFeedHintPayload('{"type":"heartbeat","latestFeedSeq":"9"}')).toBe('9');   // 修前被丢弃的增补档
    expect(parseFeedHintPayload('{"type":"heartbeat"}')).toBeNull();           // 纯心跳（无水位）不触发
    expect(parseFeedHintPayload('{"type":"doc-status","rev":1,"quota":{}}')).toBeNull();   // 通用通告静默透传
    expect(parseFeedHintPayload('not-json')).toBeNull();                       // 坏 JSON 非本协议
  });
});
