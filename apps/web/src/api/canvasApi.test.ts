import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCanvas } from './canvasApi';

describe('canvasApi teamId 透传', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('createCanvas 传 teamId 时 body 带 teamId', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { templateId: 'tp', projectId: 'p', name: 'n' } }),
    });
    await createCanvas('画布', null, 't-1');
    const init = (global.fetch as any).mock.calls[0][1];
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/canvases');
    expect(JSON.parse(init.body)).toEqual({ name: '画布', folderId: null, teamId: 't-1' });
  });

  it('createCanvas 不传 teamId 时 body 不含 teamId 字段', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { templateId: 'tp', projectId: 'p', name: 'n' } }) });
    await createCanvas('画布', null);
    const init = (global.fetch as any).mock.calls[0][1];
    expect(JSON.parse(init.body)).toEqual({ name: '画布', folderId: null });
  });
});
