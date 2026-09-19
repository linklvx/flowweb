import { ConfigProvider, Modal, theme as antdTheme } from 'antd';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function WeChatFollowModal({ open, onClose }: Props) {
  return (
    // C5 portal 岛（O5 按实测订正：初判表曾归"营销域恒浅"，实测宿主=Sidebar chrome 跟随域、组件=深色自绘
    // ——恒浅需重做字面底色属视觉变更，恒深=零视觉变更修复）：本弹层深底字面量 #1e1e1e + B2 已迁
    // text-text/text-dim-2 token 工具类，antd Modal 默认挂 body——无岛时 html.light 下 token 文字取浅值
    // #1f2329 落深底=半半。恒深双通道：darkAlgorithm 经 React context 穿透 portal（antd 通道）+
    // rootClassName="dark" 落 .ant-modal-root 使后代经 DOM 继承取 .dark 的 --fw-* 深值（CSS 变量通道）。
    <ConfigProvider theme={{ algorithm: antdTheme.darkAlgorithm }}>
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        width={320}
        rootClassName="dark"
        styles={{ content: { background: '#1e1e1e', borderRadius: 12, padding: '24px 16px' }, mask: { background: 'rgba(0,0,0,0.6)' } }}
      >
        <div className="flex flex-col items-center">
          <span className="text-base text-text">关注公众号</span>
          <img src="/img/wechat-qrcode.jpg" alt="公众号二维码" className="block w-[200px] h-[200px] rounded-lg mt-4" />
          <span className="text-xs text-text-dim-2 mt-4">扫码关注公众号，获取最新动态和专属福利</span>
        </div>
      </Modal>
    </ConfigProvider>
  );
}
