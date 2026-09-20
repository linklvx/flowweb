import { Modal } from 'antd';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function WeChatFollowModal({ open, onClose }: Props) {
  return (
    // C8 D1b 拆岛改跟随（spec §9.3/E 表 C5 三项废止）：删 ConfigProvider darkAlgorithm + rootClassName="dark"
    // ——继承 App algorithm 与 html 类；面底 token 化 var(--fw-surface)，文字沿用 text-text/text-dim-2（B2 已迁）；
    // mask rgba(0,0,0,0.6) 中性遮罩（通道 3，禁 token 化）。
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={320}
      styles={{ content: { background: 'var(--fw-surface)', borderRadius: 12, padding: '24px 16px' }, mask: { background: 'rgba(0,0,0,0.6)' } }}
    >
      <div className="flex flex-col items-center">
        <span className="text-base text-text">关注公众号</span>
        <img src="/img/wechat-qrcode.jpg" alt="公众号二维码" className="block w-[200px] h-[200px] rounded-lg mt-4" />
        <span className="text-xs text-text-dim-2 mt-4">扫码关注公众号，获取最新动态和专属福利</span>
      </div>
    </Modal>
  );
}
