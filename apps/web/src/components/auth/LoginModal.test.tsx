import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginModal } from './LoginModal';

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    logout: vi.fn(),
    refresh: vi.fn(),
    updateUser: vi.fn(),
  }),
}));

describe('LoginModal', () => {
  const mockOnClose = vi.fn();

  beforeAll(() => {
    // AntD Modal's useScrollLocker needs getComputedStyle with pseudo elements
    // jsdom doesn't support it, so we mock it
    if (!window.getComputedStyle) {
      window.getComputedStyle = () => ({} as CSSStyleDeclaration);
    }
    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = (elt: Element, pseudoElt?: string | null) => {
      if (pseudoElt) {
        // Return an empty CSSStyleDeclaration for pseudo-element queries
        return {
          getPropertyValue: () => '',
          length: 0,
        } as unknown as CSSStyleDeclaration;
      }
      return originalGetComputedStyle(elt);
    };
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // WeChatQRLogin 挂载会请求 config 接口；用 pending promise 停在加载态，
    // 避免异步 setState 触发 act 警告（LoginModal 测试不关心二维码内容）
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
  });

  const renderModal = (props?: Partial<Parameters<typeof LoginModal>[0]>) =>
    render(<LoginModal onClose={mockOnClose} {...props} />);

  it('should render banner, phone form, divider, wechat QR, and agreement footer', () => {
    const bannerUrl = 'https://example.com/banner.png';
    renderModal({ bannerUrl });
    expect(screen.getByAltText('登录Banner')).toBeInTheDocument();
    expect(screen.getByText('手机号登录')).toBeInTheDocument();
    expect(screen.getByText('微信扫码登录')).toBeInTheDocument();
    expect(screen.getByText('使用微信扫码快捷登录')).toBeInTheDocument();
    expect(
      screen.getByText(/登录即代表同意/),
    ).toBeInTheDocument();
  });

  it('should call onClose when modal is closed', () => {
    renderModal();
    // AntD Modal renders aria-label="Close" on the close button
    const closeBtn = screen.getByLabelText('Close');
    fireEvent.click(closeBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('should show banner fallback when image fails to load', () => {
    const bannerUrl = 'https://invalid.com/banner.png';
    renderModal({ bannerUrl });
    const bannerImg = screen.getByAltText('登录Banner');
    fireEvent.error(bannerImg);
    expect(screen.getByText('Flow123')).toBeInTheDocument();
  });

  it('should show banner fallback when no bannerUrl provided', () => {
    renderModal();
    expect(screen.getByText('Flow123')).toBeInTheDocument();
  });

  it('should render with custom bannerUrl', () => {
    const bannerUrl = 'https://example.com/banner.png';
    renderModal({ bannerUrl });
    const img = screen.getByAltText('登录Banner');
    expect(img).toHaveAttribute('src', bannerUrl);
  });

  it('should match snapshot', () => {
    const { asFragment } = renderModal();
    expect(asFragment()).toMatchSnapshot();
  });
});
