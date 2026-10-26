// apps/api/src/modules/collab/runtime-feed.t22-closeout.spec.ts
// Y1c T22 收口批单测面（非 PG——直构 mock）：
//  M-15=appendEventTransaction lastKnown **提交后写**（原 append 闭包内事务提交前即写——心跳
//  enricher 同步读会广播未提交 feedSeq=幽灵水位：客户端 h>cursor 拉取却查不到事件）；
//  M-16=events 端点 after 畸形 400（原静默折 0——客户端游标损坏被掩盖为全量重放流量）。
import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { RuntimeFeedService } from './runtime-feed.service';
import { RuntimeFeedController } from './runtime-feed.controller';

describe('Y1c T22 收口批：RuntimeFeedService M-15（lastKnown 提交后写）', () => {
  it('appendEventTransaction：append 闭包内不写 lastKnown——$transaction resolve 后才写（心跳快照不抢跑未提交序）', async () => {
    const seenBeforeCommit: Array<string | bigint | null> = [];
    const fakeTx = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        if (sql.includes('FROM "CanvasDoc"')) return [{ generation: 0, pgSeq: 5n }];
        if (sql.includes('"RuntimeFeedCursor"')) return [{ lastSeq: 1n }];
        return [];
      },
      runtimeEvent: { create: async () => ({}) },
    };
    const prisma = {
      // 伪事务：body 执行完（事务将提交而未 resolve）时刻采样 lastKnown——修前 append 闭包内已写=红
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const r = await fn(fakeTx);
        seenBeforeCommit.push(feed.peekLatestFeedSeq('p-m15'));
        return r;
      },
    } as unknown as PrismaService;
    const feed = new RuntimeFeedService(prisma);
    await feed.appendEventTransaction('p-m15', async (_tx, append) => {
      await append('exec.status', () => ({ nodeId: 'n1', status: 'x', attempts: 1 }));
      // 闭包内（事务体中）lastKnown 仍空——修前此处已写=未提交序外泄
      expect(feed.peekLatestFeedSeq('p-m15')).toBeNull();
    });
    expect(seenBeforeCommit[0]).toBeNull();   // 提交时刻（$transaction 未 resolve）仍空——M-15 红/绿锚
    expect(feed.peekLatestFeedSeq('p-m15')).toBe(1n);   // resolve 后写（提交后值）
  });
});

describe('Y1c T22 收口批：RuntimeFeedController M-16（after 畸形 400）', () => {
  const perm = { assertEditor: async () => undefined } as never;
  const feedStub = {
    readAfter: async (_pid: string, after: bigint, _limit: number) => [{ id: 'e1', feedSeq: after + 1n, generation: 0, kind: 'exec.status', payload: {}, docSeq: null, createdAt: new Date() }],
    latestFeedSeq: async () => 9n,
    minRetainedSeq: async () => 0n,
    currentHistoryId: async () => 'h-1',
  } as never;
  const ctrl = new RuntimeFeedController(feedStub, perm);

  it('after 非十进制串=400 BadRequestException（原静默折 0）', async () => {
    await expect(ctrl.events('p1', { user: { id: 'u1' } } as never, '12x', 200)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctrl.events('p1', { user: { id: 'u1' } } as never, '-1', 200)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctrl.events('p1', { user: { id: 'u1' } } as never, '', 200)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('合法 after 原样传 service（readAfter after=BigInt 值）', async () => {
    const env = await ctrl.events('p1', { user: { id: 'u1' } } as never, '5', 200);
    expect(env.events).toHaveLength(1);
    expect(env.latestFeedSeq).toBe('9');
    expect(env.historyId).toBe('h-1');
  });
});
