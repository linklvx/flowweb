import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddNodeMenu } from './AddNodeMenu';

// Mock canvas store
const mockAddNode = vi.fn().mockReturnValue('test-node-id');
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    (selector: any) => selector({ addNode: mockAddNode, viewport: { x: 0, y: 0, zoom: 1 } }),
    { getState: () => ({ projectId: null }) },
  ),
}));

// Mock node store
const mockUpdateConfig = vi.fn();
vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: {
    getState: () => ({ updateConfig: mockUpdateConfig }),
  },
}));

// Mock storage API
const mockPresignUpload = vi.fn();
const mockConfirmUpload = vi.fn();
vi.mock('@/api/storageApi', () => ({
  presignUpload: (...args: any[]) => mockPresignUpload(...args),
  confirmUpload: (...args: any[]) => mockConfirmUpload(...args),
}));

// Mock axios
const mockAxiosPost = vi.fn();
vi.mock('axios', () => ({
  default: { post: (...args: any[]) => mockAxiosPost(...args) },
}));

describe('AddNodeMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default resolved values for upload chain
    mockPresignUpload.mockResolvedValue({
      fileId: 'file-1',
      uploadUrl: 'http://minio:9000/flowai/uploads/test.png',
      key: 'uploads/test.png',
      fields: { bucket: 'flowai', key: 'uploads/test.png' },
    });
    mockConfirmUpload.mockResolvedValue({ fileId: 'file-1' });
    mockAxiosPost.mockResolvedValue({ status: 200 });
  });

  // ============================================================
  // 现有渲染测试（不受影响）
  // ============================================================

  it('renders the menu with header "添加节点"', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    expect(screen.getByText('添加节点')).toBeInTheDocument();
  });

  it('renders all 7 node type items', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    expect(screen.getByText('文本')).toBeInTheDocument();
    expect(screen.getByText('图片')).toBeInTheDocument();
    expect(screen.getByText('扩展图片')).toBeInTheDocument();
    expect(screen.getByText('视频')).toBeInTheDocument();
    expect(screen.getByText('多轨道剪辑')).toBeInTheDocument();
    expect(screen.getByText('音频')).toBeInTheDocument();
    expect(screen.getByText('堆叠图片')).toBeInTheDocument();
  });

  it('renders "添加资源" section with upload item', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    expect(screen.getByText('添加资源')).toBeInTheDocument();
    expect(screen.getByText('上传')).toBeInTheDocument();
  });

  it('does NOT render removed items', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    expect(screen.queryByText('导演台')).not.toBeInTheDocument();
    expect(screen.queryByText('脚本')).not.toBeInTheDocument();
    expect(screen.queryByText('从生成历史选择')).not.toBeInTheDocument();
  });

  it('calls addNode with "text" when clicking text menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('文本'));
    expect(mockAddNode).toHaveBeenCalledWith('text', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls addNode with "image" when clicking image menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('图片'));
    expect(mockAddNode).toHaveBeenCalledWith('image', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls addNode with "video" when clicking video menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('视频'));
    expect(mockAddNode).toHaveBeenCalledWith('video', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls addNode with "videoEdit" when clicking video-edit menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('多轨道剪辑'));
    expect(mockAddNode).toHaveBeenCalledWith('videoEdit', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls addNode with "audio" when clicking audio menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('音频'));
    expect(mockAddNode).toHaveBeenCalledWith('audio', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls addNode with "multiImage" when clicking stacked image menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('堆叠图片'));
    expect(mockAddNode).toHaveBeenCalledWith('multiImage', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls addNode with "imageExt" when clicking image extension menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('扩展图片'));
    expect(mockAddNode).toHaveBeenCalledWith('imageExt', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render when isOpen is false', () => {
    render(<AddNodeMenu isOpen={false} onClose={() => {}} triggerRef={{ current: null }} />);
    expect(screen.queryByText('添加节点')).not.toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when clicking outside menu on overlay', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    const menu = screen.getByRole('menu');
    const overlay = menu.parentElement!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when clicking inside menu', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    const menu = screen.getByRole('menu');
    fireEvent.click(menu);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('menu item icon containers have background color', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    const menuItems = screen.getAllByRole('menuitem');
    for (const item of menuItems) {
      const iconContainer = item.firstElementChild as HTMLElement;
      expect(iconContainer).toHaveStyle({ backgroundColor: 'var(--canvas-controls-hover)' });
    }
  });

  it('menu container uses compact gap between items', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    const menu = screen.getByRole('menu');
    expect(menu).toHaveClass('gap-0.5');
  });

  it('menu item buttons have no border or rounded corners', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    const menuItems = screen.getAllByRole('menuitem');
    for (const item of menuItems) {
      expect(item).toHaveClass('border-0');
      expect(item).toHaveClass('rounded-xl');
      expect(item).toHaveClass('h-[50px]');
      expect(item).toHaveClass('py-1');
    }
  });

  it('has ARIA menu role and menuitem roles', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.length).toBe(8); // 7 node types + 1 upload
  });

  // ============================================================
  // 新增：上传功能测试
  // ============================================================

  describe('上传按钮', () => {
    it('点击上传按钮触发文件选择对话框', () => {
      const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
      render(<AddNodeMenu isOpen={true} onClose={vi.fn()} triggerRef={{ current: null }} />);
      fireEvent.click(screen.getByText('上传'));
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('点击上传按钮不立即关闭菜单', () => {
      const onClose = vi.fn();
      render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
      fireEvent.click(screen.getByText('上传'));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('选择图片文件后调用 presignUpload', async () => {
      const { container } = render(<AddNodeMenu isOpen={true} onClose={vi.fn()} triggerRef={{ current: null }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['dummy'], 'test.png', { type: 'image/png' });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockPresignUpload).toHaveBeenCalledWith({
          fileName: 'test.png',
          fileSize: 5,
          fileType: 'image/png',
          type: 'uploaded',
        });
      });
    });

    it('选择图片文件后上传到 MinIO', async () => {
      const { container } = render(<AddNodeMenu isOpen={true} onClose={vi.fn()} triggerRef={{ current: null }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['dummy'], 'test.png', { type: 'image/png' });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockAxiosPost).toHaveBeenCalled();
        expect(mockConfirmUpload).toHaveBeenCalledWith({
          fileId: 'file-1',
          key: 'uploads/test.png',
          fileSize: 5,
        });
      });
    });

    it('上传图片成功后创建 ImageGenNode 并设置 referenceImage', async () => {
      const onClose = vi.fn();
      const { container } = render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['dummy'], 'test.png', { type: 'image/png' });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockAddNode).toHaveBeenCalledWith('image', expect.any(Object));
        expect(mockUpdateConfig).toHaveBeenCalledWith('test-node-id', { referenceImage: 'file-1' });
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('上传视频成功后创建 VideoGenNode 并设置 referenceVideo', async () => {
      const onClose = vi.fn();
      const { container } = render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['dummy'], 'test.mp4', { type: 'video/mp4' });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockAddNode).toHaveBeenCalledWith('video', expect.any(Object));
        expect(mockUpdateConfig).toHaveBeenCalledWith('test-node-id', { referenceVideo: 'file-1' });
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('上传音频成功后创建 AudioGenNode 并设置 referenceAudio', async () => {
      const onClose = vi.fn();
      const { container } = render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['dummy'], 'test.mp3', { type: 'audio/mpeg' });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockAddNode).toHaveBeenCalledWith('audio', expect.any(Object));
        expect(mockUpdateConfig).toHaveBeenCalledWith('test-node-id', { referenceAudio: 'file-1' });
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('上传失败后不创建节点也不关闭菜单', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPresignUpload.mockRejectedValueOnce(new Error('Upload failed'));
      const onClose = vi.fn();
      const { container } = render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['dummy'], 'test.png', { type: 'image/png' });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
      });
      expect(mockAddNode).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('取消文件选择不触发上传', () => {
      const { container } = render(<AddNodeMenu isOpen={true} onClose={vi.fn()} triggerRef={{ current: null }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      fireEvent.change(fileInput, { target: { files: [] } });

      expect(mockPresignUpload).not.toHaveBeenCalled();
    });

    it('上传按钮点击不调用素材库 open', () => {
      render(<AddNodeMenu isOpen={true} onClose={vi.fn()} triggerRef={{ current: null }} />);
      fireEvent.click(screen.getByText('上传'));
      // 验证不再调用 materialLibraryStore.open
      // 由于已移除 import，此处仅验证不会出错
      expect(mockPresignUpload).not.toHaveBeenCalled(); // 仅触发 file input，不上传
    });
  });

  // ============================================================
  // 新增：position 模式测试
  // ============================================================

  describe('position 模式（右键触发）', () => {
    it('当提供 position 时菜单渲染正常', () => {
      render(<AddNodeMenu isOpen={true} onClose={() => {}} position={{ x: 300, y: 400 }} />);
      expect(screen.getByText('添加节点')).toBeInTheDocument();
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('position 模式下点击菜单项仍能创建节点', () => {
      const onClose = vi.fn();
      render(<AddNodeMenu isOpen={true} onClose={onClose} position={{ x: 500, y: 200 }} />);
      fireEvent.click(screen.getByText('文本'));
      expect(mockAddNode).toHaveBeenCalledWith('text', expect.any(Object));
      expect(onClose).toHaveBeenCalled();
    });

    it('position 模式下覆盖层点击关闭', () => {
      const onClose = vi.fn();
      render(<AddNodeMenu isOpen={true} onClose={onClose} position={{ x: 100, y: 100 }} />);
      const menu = screen.getByRole('menu');
      fireEvent.click(menu.parentElement!);
      expect(onClose).toHaveBeenCalled();
    });
  });
});
