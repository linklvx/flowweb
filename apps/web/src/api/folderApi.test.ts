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

  it('createFolder 传 teamId 时 body 带 teamId', async () => {
    (global.fetch as any).mockResolvedValue(ok({ id: 'f1' }));
    const { createFolder } = await import('./folderApi');
    await createFolder('新文件夹', 't-1');
    const init = (global.fetch as any).mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: '新文件夹', teamId: 't-1' });
  });
});
