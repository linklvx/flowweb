import { useEffect, useRef, useState, useCallback } from 'react';
import { Modal, message } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { io, Socket } from 'socket.io-client';
import { subscriptionApi } from '../api/subscriptionApi';

interface WeChatQRModalProps {
  visible: boolean;
  codeUrl: string;
  orderNo: string;
  amount: number; // 元
  expiredAt: string; // ISO string
  onSuccess: () => void;
  onCancel: () => void;
  // Optional props for subscription orders (defaults to recharge methods)
  queryOrderFn?: (orderNo: string) => Promise<{ status: string }>;
  closeOrderFn?: (orderNo: string) => Promise<{ success: boolean }>;
  successEventName?: string;
  failedEventName?: string;
}

export function WeChatQRModal({
  visible,
  codeUrl,
  orderNo,
  amount,
  expiredAt,
  onSuccess,
  onCancel,
  queryOrderFn = subscriptionApi.queryRechargeOrder,
  closeOrderFn = subscriptionApi.closeRechargeOrder,
  successEventName = 'payment:success',
  failedEventName = 'payment:failed',
}: WeChatQRModalProps) {
  const [countdown, setCountdown] = useState('--:--');
  const [status, setStatus] = useState<'waiting' | 'success' | 'closed' | 'failed'>('waiting');
  const socketRef = useRef<Socket | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  const stopAll = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(async () => {
    stopAll();
    try {
      await closeOrderFn(orderNo);
    } catch { /* best-effort */ }
    onCancel();
  }, [orderNo, onCancel, stopAll]);

  useEffect(() => {
    if (!visible) return;

    startTimeRef.current = Date.now();
    setStatus('waiting');

    // Countdown timer
    const expiry = new Date(expiredAt).getTime();
    const timer = setInterval(() => {
      const remaining = Math.max(0, expiry - Date.now());
      if (remaining <= 0) {
        setCountdown('00:00');
        clearInterval(timer);
        handleCancel();
        return;
      }
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }, 500);

    // Socket.io main channel
    const socket = io('/payment', {
      auth: {
        token: document.cookie.match(/flowweb\.session_token=([^;]+)/)?.[1] || '',
      },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join:order', { orderNo });
    });

    socket.on(successEventName, () => {
      setStatus('success');
      clearInterval(timer);
      stopAll();
      onSuccess();
    });

    socket.on(failedEventName, () => {
      setStatus('failed');
      clearInterval(timer);
      stopAll();
    });

    // Polling fallback
    const getInterval = () => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      if (elapsed < 30) return 2000;
      if (elapsed < 120) return 5000;
      return 10000;
    };

    const poll = async () => {
      try {
        const order = await queryOrderFn(orderNo);
        if (order.status === 'SUCCESS') {
          setStatus('success');
          clearInterval(timer);
          stopAll();
          onSuccess();
        } else if (order.status === 'CLOSED' || order.status === 'FAILED') {
          setStatus(order.status === 'CLOSED' ? 'closed' : 'failed');
          clearInterval(timer);
          stopAll();
        } else {
          // Reschedule with next interval
          clearInterval(pollingRef.current!);
          pollingRef.current = setTimeout(poll, getInterval());
        }
      } catch { /* ignore errors, retry on next poll */ }
    };
    pollingRef.current = setTimeout(poll, getInterval());

    return () => {
      clearInterval(timer);
      stopAll();
    };
  }, [visible, orderNo, expiredAt, onSuccess, handleCancel, stopAll, queryOrderFn, closeOrderFn, successEventName, failedEventName]);

  return (
    <Modal
      open={visible}
      title="微信扫码支付"
      onCancel={handleCancel}
      footer={null}
      width={360}
      destroyOnClose
    >
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        {codeUrl && status === 'waiting' && (
          <QRCodeSVG value={codeUrl} size={200} />
        )}
        {status === 'success' && (
          <div style={{ color: '#4ade80', fontSize: 48 }}>✓</div>
        )}
        {status === 'closed' && (
          <div style={{ color: '#666', fontSize: 14 }}>订单已关闭</div>
        )}
        {status === 'failed' && (
          <div style={{ color: '#ef4444', fontSize: 14 }}>支付失败</div>
        )}

        <div style={{ marginTop: 16, fontSize: 24, fontWeight: 600 }}>
          ¥{amount.toFixed(2)}
        </div>

        {status === 'waiting' && (
          <>
            <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
              请使用微信扫描二维码完成支付
            </div>
            <div style={{ marginTop: 8, fontSize: 20, fontFamily: 'monospace', color: '#f59e0b' }}>
              {countdown}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
