import { Modal } from 'antd';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function WeChatFollowModal({ open, onClose }: Props) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={320}
      styles={{ content: { background: '#1e1e1e', borderRadius: 12, padding: '24px 16px' }, mask: { background: 'rgba(0,0,0,0.6)' } }}
    >
      <div className="flex flex-col items-center">
        <span className="text-base text-text">关注公众号</span>
        <img src="/img/wechat-qrcode.jpg" alt="公众号二维码" className="block w-[200px] h-[200px] rounded-lg mt-4" />
        <span className="text-xs text-[#707070] mt-4">扫码关注公众号，获取最新动态和专属福利</span>
      </div>
    </Modal>
  );
}
