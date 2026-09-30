// apps/api/src/modules/video-project/video-project.regenerate.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { VideoProjectService } from './video-project.service';

describe('regenerate（批5-1 直连真实节点——影子信箱删除）', () => {
  let svc: VideoProjectService; let prisma: any; let collab: any; let execution: any;
  const perm = { assertEditor: vi.fn().mockResolvedValue('E') };
  const quota = { assertCanUpload: vi.fn() };

  beforeEach(() => {
    prisma = { videoProject: { findUnique: vi.fn() } };
    // insertNode/removeNode 已随信箱删除——mock 不提供（regenerate 误用即红）；
    // writeNodeData 提供并断言零调用：产物落地（fileId/result 写真实节点）由 execute→ai-download 既有链承载
    collab = { readCanvas: vi.fn(), writeNodeData: vi.fn() };
    execution = { execute: vi.fn().mockResolvedValue({ success: true, results: [{ nodeId: 'src1', type: 'video', resultUrl: 'https://x/v.mp4' }] }) };
    svc = new VideoProjectService(prisma, perm as any, collab as any, execution as any, quota as any);
  });

  it('直连真实节点：execute(workflowId, sourceNodeId, userId, nodeIds=undefined, sv=undefined, retakeId)——无影子插入、regenerate 自身零 doc 写', async () => {
    collab.readCanvas.mockResolvedValue({
      nodes: [{ id: 'src1', type: 'videoGen', position: { x: 1, y: 2 }, data: { model: 'm', prompt: { text: 't' } } }],
      edges: [],
    });
    const r = await svc.regenerate('u1', { sourceNodeId: 'src1', workflowId: 'w1', kind: 'video', retakeId: 'rtk-1' });
    // sv 位（第 5 参）= undefined：直调不带 sv——E2 根因（sv 裁剪致影子不可见）随信箱消失；
    // retakeId 作 intentId 透传 execute——幂等裁决在 claim 层（同 retakeId 重放 SUCCEEDED → 零外呼零扣费）
    expect(execution.execute).toHaveBeenCalledWith('w1', 'src1', 'u1', undefined, undefined, 'rtk-1');
    expect(collab.writeNodeData).not.toHaveBeenCalled(); // Media.create/writeNodeData(fileId) 由 execute→ai-download 落真实节点，服务层不重复落地（防双 Media 行）
    // result 原样透传（success=false 早失败语义维持——web 侧 initial 契约）
    expect(r).toEqual({
      retakeId: 'rtk-1',
      result: { success: true, results: [{ nodeId: 'src1', type: 'video', resultUrl: 'https://x/v.mp4' }] },
    });
  });

  it('同 retakeId 重放：服务层恒透传不拦（幂等由 execute 内 claim 层裁决——双发也不在此重复外呼控制）', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [{ id: 'src1', type: 'videoGen', data: { model: 'm' } }], edges: [] });
    await svc.regenerate('u1', { sourceNodeId: 'src1', workflowId: 'w1', kind: 'video', retakeId: 'rtk-same' });
    await svc.regenerate('u1', { sourceNodeId: 'src1', workflowId: 'w1', kind: 'video', retakeId: 'rtk-same' });
    expect(execution.execute).toHaveBeenCalledTimes(2);
    expect(execution.execute).toHaveBeenLastCalledWith('w1', 'src1', 'u1', undefined, undefined, 'rtk-same');
  });

  it('kind=audio → audioGen 类型匹配后同样直连', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [{ id: 'a1', type: 'audioGen', data: { model: 'm' } }], edges: [] });
    await svc.regenerate('u1', { sourceNodeId: 'a1', workflowId: 'w1', kind: 'audio', retakeId: 'rtk-a' });
    expect(execution.execute).toHaveBeenCalledWith('w1', 'a1', 'u1', undefined, undefined, 'rtk-a');
  });

  it('源节点类型不匹配：400（video/audio 两分支显式传 kind——防"缺省 kind 因错误原因通过"）', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [{ id: 'x', type: 'videoEdit', data: {} }], edges: [] });
    await expect(svc.regenerate('u1', { sourceNodeId: 'x', workflowId: 'w1', kind: 'video', retakeId: 'r1' })).rejects.toThrow(BadRequestException);
    await expect(svc.regenerate('u1', { sourceNodeId: 'x', workflowId: 'w1', kind: 'audio', retakeId: 'r1' })).rejects.toThrow(BadRequestException);
    expect(execution.execute).not.toHaveBeenCalled();
  });
  it('源节点不存在：400', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [], edges: [] });
    await expect(svc.regenerate('u1', { sourceNodeId: 'nope', workflowId: 'w1', kind: 'video', retakeId: 'r1' })).rejects.toThrow(BadRequestException);
    expect(execution.execute).not.toHaveBeenCalled();
  });
});
