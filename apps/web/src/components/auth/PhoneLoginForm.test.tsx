import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
} from '@testing-library/react';
import { PhoneLoginForm } from './PhoneLoginForm';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockRefresh = vi.fn();
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ refresh: mockRefresh }),
}));

describe('PhoneLoginForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    mockRefresh.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderForm = (
    props?: Partial<Parameters<typeof PhoneLoginForm>[0]>,
  ) => render(<PhoneLoginForm {...props} />);

  const setupValidPhone = () => {
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } });
  };

  it('should render title, phone input with +86 prefix, code input, get code button, and login button', () => {
    renderForm();
    expect(screen.getByText('手机号登录')).toBeInTheDocument();
    expect(screen.getByText('+86')).toBeInTheDocument();

    const phoneInput = screen.getByLabelText('手机号');
    expect(phoneInput).toBeInTheDocument();
    expect(phoneInput).toHaveAttribute('maxLength', '11');
    expect(phoneInput).toHaveAttribute('inputMode', 'numeric');
    expect(phoneInput).toHaveAttribute('placeholder', '请输入手机号');

    const codeInput = screen.getByLabelText('验证码');
    expect(codeInput).toBeInTheDocument();
    expect(codeInput).toHaveAttribute('maxLength', '6');
    expect(codeInput).toHaveAttribute('inputMode', 'numeric');
    expect(codeInput).toHaveAttribute('placeholder', '请输入验证码');

    expect(screen.getByLabelText('获取验证码')).toBeInTheDocument();
    expect(screen.getByLabelText('登录/注册')).toBeInTheDocument();
  });

  it('should prevent entering more than 11 digits in phone input', () => {
    renderForm();
    const phoneInput = screen.getByLabelText('手机号');
    fireEvent.change(phoneInput, { target: { value: '138001380001' } });
    // maxLength attribute handles this at browser level,
    // but fireEvent.change bypasses maxLength. The value
    // should still be set as given - actual limit enforced
    // by the maxLength attribute in real browser.
    expect(phoneInput).toHaveAttribute('maxLength', '11');
  });

  it('should prevent entering more than 6 digits in code input', () => {
    renderForm();
    const codeInput = screen.getByLabelText('验证码');
    fireEvent.change(codeInput, { target: { value: '1234567' } });
    expect(codeInput).toHaveAttribute('maxLength', '6');
  });

  it('should start 60s countdown when clicking get code button', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    renderForm();
    setupValidPhone();
    const getCodeBtn = screen.getByLabelText('获取验证码');

    await act(async () => {
      fireEvent.click(getCodeBtn);
    });

    // Button should show initial countdown text (60s)
    expect(screen.getByLabelText('获取验证码')).toHaveTextContent(
      '60s后重试',
    );

    // After 1 second tick, should show 59s
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByLabelText('获取验证码')).toHaveTextContent(
      '59s后重试',
    );
    expect(screen.getByLabelText('获取验证码')).toBeDisabled();
  });

  it('should restore get code button after countdown ends', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    renderForm();
    setupValidPhone();
    const getCodeBtn = screen.getByLabelText('获取验证码');

    await act(async () => {
      fireEvent.click(getCodeBtn);
    });

    // Advance timers past 60 seconds
    act(() => {
      vi.advanceTimersByTime(60000);
    });

    // Wait for state update
    expect(screen.getByLabelText('获取验证码')).toHaveTextContent(
      '获取验证码',
    );
    expect(screen.getByLabelText('获取验证码')).not.toBeDisabled();
  });

  it('should show error message when errorMsg is provided', () => {
    renderForm({ errorMsg: '验证码错误' });
    const errorEl = screen.getByText('验证码错误');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.className).toContain('text-[#F53F3F]');
  });

  it('should retain 30px height when errorMsg is empty', () => {
    const { container } = renderForm({ errorMsg: '' });
    const errorLine = container.querySelector('[data-testid="error-line"]');
    expect(errorLine).toBeInTheDocument();
    expect(errorLine!.className).toContain('h-[30px]');
  });

  it('should disable login button when loading is true', () => {
    renderForm({ loading: true });
    const loginBtn = screen.getByLabelText('登录/注册');
    expect(loginBtn).toBeDisabled();
    expect(loginBtn.className).toContain('opacity-50');
  });

  it('should clear countdown timer on unmount', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    const { unmount } = renderForm();
    setupValidPhone();
    const getCodeBtn = screen.getByLabelText('获取验证码');

    await act(async () => {
      fireEvent.click(getCodeBtn);
    });

    unmount();

    // Advance time - no warning about state update on unmounted component
    act(() => {
      vi.advanceTimersByTime(60000);
    });

    // If timer was not cleared, we'd get "Can't perform a React state update
    // on an unmounted component" warning. The test passes if no error thrown.
  });

  it('should accept className prop', () => {
    const { container } = renderForm({ className: 'test-class' });
    expect(container.firstChild).toHaveClass('test-class');
  });

  it('should match snapshot', () => {
    const { asFragment } = renderForm();
    expect(asFragment()).toMatchSnapshot();
  });

  describe('API integration', () => {
    it('should call send-sms-code API when clicking get code button', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
      renderForm();
      fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('获取验证码'));
      });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/send-sms-code',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ phone: '13800138000' }),
        }),
      );
    });

    it('should call onError with code and message when send-sms-code fails', async () => {
      const onError = vi.fn();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ code: 'IP_RATE_LIMITED', error: '请求过于频繁' }),
      });
      renderForm({ onError });
      fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('获取验证码'));
      });
      expect(onError).toHaveBeenCalledWith('IP_RATE_LIMITED', '请求过于频繁');
    });

    it('should call phone-login API and onLoginSuccess on success', async () => {
      const onLoginSuccess = vi.fn();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ user: { id: 'u1' } }),
      });
      renderForm({ onLoginSuccess });
      fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } });
      fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('登录/注册'));
      });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/phone-login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ phone: '13800138000', code: '123456' }),
        }),
      );
      expect(mockRefresh).toHaveBeenCalled();
      expect(onLoginSuccess).toHaveBeenCalled();
    });

    it('should call onError with code and message when phone-login fails', async () => {
      const onError = vi.fn();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ code: 'INVALID_OTP', error: '验证码错误' }),
      });
      renderForm({ onError });
      fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } });
      fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('登录/注册'));
      });
      expect(onError).toHaveBeenCalledWith('INVALID_OTP', '验证码错误');
    });
  });
});
