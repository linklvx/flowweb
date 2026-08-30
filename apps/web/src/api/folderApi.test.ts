import { describe, it, expect, vi, beforeEach } from 'vitest';

const ok = (data: unknown) => ({ ok: true, json: async () => ({ code: 0, data }) });

describe('folderApi teamId 透传', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('getFolders 传 teamId 时 query 带 teamId', async () => {
    (global.fetch as any).mockResolvedValue(ok({ folders: [] }));
    const { getFolders } = await import('./folderApi');
    await getFolders('t-1');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/folders?teamId=t-1');
  });

  it('getFolders 不传 teamId 时保持原 URL', async () => {
    (global.fetch as any).mockResolvedValue(ok({ folders: [] }));
    const { getFolders } = await import('./folderApi');
    await getFolders();
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/folders');
  });

  it('createFolder 传 teamId 时 query 带 teamId（后端 create 只认 @Query，body teamId 会被 whitelist 剥离落个人作用域）', async () => {
    (global.fetch as any).mockResolvedValue(ok({ id: 'f1' }));
    const { createFolder } = await import('./folderApi');
    await createFolder('新文件夹', 't-1');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/folders?teamId=t-1');
    const init = (global.fetch as any).mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: '新文件夹' });
  });

  it('createFolder 不传 teamId 时保持原 URL', async () => {
    (global.fetch as any).mockResolvedValue(ok({ id: 'f1' }));
    const { createFolder } = await import('./folderApi');
    await createFolder('新文件夹');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/folders');
  });
});

describe('folderApi rename/delete teamId 通道', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('renameFolder 带 teamId → PATCH query', async () => {
    (global.fetch as any).mockResolvedValue(ok({ id: 'f1' }));
    const { renameFolder } = await import('./folderApi');
    await renameFolder('f1', '新名', 't1');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/folders/f1?teamId=t1');
    const init = (global.fetch as any).mock.calls[0][1];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ name: '新名' });
  });

  it('renameFolder 无 teamId → 无 query（个人=默认团队回落）', async () => {
    (global.fetch as any).mockResolvedValue(ok({ id: 'f1' }));
    const { renameFolder } = await import('./folderApi');
    await renameFolder('f1', '新名');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/folders/f1');
    expect((global.fetch as any).mock.calls[0][1].method).toBe('PATCH');
  });

  it('deleteFolder 带 teamId → DELETE query', async () => {
    (global.fetch as any).mockResolvedValue(ok({ movedCanvasCount: 0 }));
    const { deleteFolder } = await import('./folderApi');
    await deleteFolder('f1', 't1');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/folders/f1?teamId=t1');
    expect((global.fetch as any).mock.calls[0][1].method).toBe('DELETE');
  });

  it('deleteFolder 无 teamId → 无 query', async () => {
    (global.fetch as any).mockResolvedValue(ok({ movedCanvasCount: 0 }));
    const { deleteFolder } = await import('./folderApi');
    await deleteFolder('f1');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/folders/f1');
    expect((global.fetch as any).mock.calls[0][1].method).toBe('DELETE');
  });
});
