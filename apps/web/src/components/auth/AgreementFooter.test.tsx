import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgreementFooter } from './AgreementFooter';

describe('AgreementFooter', () => {
  const renderFooter = (className?: string) =>
    render(<AgreementFooter className={className} />);

  it('should render agreement text in a single line', () => {
    renderFooter();
    expect(
      screen.getByText(/登录即代表同意/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('《用户协议》'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('《隐私政策》'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/未注册手机号将自动注册/),
    ).toBeInTheDocument();
  });

  it('should render links with href="#" and security attributes', () => {
    renderFooter();
    const userAgreement = screen.getByText('《用户协议》');
    const privacyPolicy = screen.getByText('《隐私政策》');

    expect(userAgreement).toHaveAttribute('href', '#');
    expect(userAgreement).toHaveAttribute('target', '_blank');
    expect(userAgreement).toHaveAttribute('rel', 'noopener noreferrer');

    expect(privacyPolicy).toHaveAttribute('href', '#');
    expect(privacyPolicy).toHaveAttribute('target', '_blank');
    expect(privacyPolicy).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('should have primary color class on links', () => {
    renderFooter();
    const userAgreement = screen.getByText('《用户协议》');
    const privacyPolicy = screen.getByText('《隐私政策》');

    expect(userAgreement.className).toContain('text-[#1F6DFF]');
    expect(privacyPolicy.className).toContain('text-[#1F6DFF]');
  });

  it('should accept className prop', () => {
    const { container } = renderFooter('custom-class');
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('should match snapshot', () => {
    const { asFragment } = renderFooter();
    expect(asFragment()).toMatchSnapshot();
  });
});
