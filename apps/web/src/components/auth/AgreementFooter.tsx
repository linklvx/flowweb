export interface AgreementFooterProps {
  className?: string;
}

export function AgreementFooter({ className = '' }: AgreementFooterProps) {
  return (
    <div
      className={`flex justify-center bg-[#F8F8F8] w-full rounded-b-[12px] py-3 text-[12px] text-[#787878] ${className}`}
    >
      <p className="m-0">
        登录即代表同意
        {/* TODO: 替换为真实路由 */}
        <a
          href="#"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#1F6DFF]"
        >
          《用户协议》
        </a>
        和
        {/* TODO: 替换为真实路由 */}
        <a
          href="#"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#1F6DFF]"
        >
          《隐私政策》
        </a>
        未注册手机号将自动注册
      </p>
    </div>
  );
}
