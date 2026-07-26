import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SDK before importing the provider
const mockNativePost = vi.fn();
const mockOutTradeNoGet = vi.fn();
const mockClosePost = vi.fn();
const mockDecrypt = vi.fn();

vi.mock('wechatpay-axios-plugin', () => ({
  Wechatpay: vi.fn().mockImplementation(() => ({
    v3: {
      pay: {
        transactions: {
          native: { post: mockNativePost },
          outTradeNo: (orderNo: string) => ({
            get: () => mockOutTradeNoGet(orderNo),
            close: { post: (params: unknown) => mockClosePost(orderNo, params) },
          }),
        },
      },
    },
  })),
  Aes: { AesGcm: { decrypt: (...args: unknown[]) => mockDecrypt(...args) } },
}));

import { WechatPaymentProvider } from './wechat-payment.provider';

describe('WechatPaymentProvider', () => {
  const validEnv = {
    WECHAT_PAY_MCH_ID: '1234567890',
    WECHAT_PAY_MERCHANT_SERIAL_NO: '77D5D85B4F8D919C12DE0BCE8B614E6490EDC71B',
    WECHAT_PAY_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----',
    WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_01',
    WECHAT_PAY_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nMOCK_PUB_KEY\n-----END PUBLIC KEY-----',
    WECHAT_PAY_APP_ID: 'wx1234567890abcdef',
    WECHAT_PAY_API_V3_KEY: '5fc67c183c3a575130c66517a707cf0a',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('normalizePem', () => {
    it('should convert literal \\n to real newlines', () => {
      const input = '-----BEGIN KEY-----\\nline1\\nline2\\n-----END KEY-----';
      const result = (WechatPaymentProvider as any).normalizePem(input);
      expect(result).toBe('-----BEGIN KEY-----\nline1\nline2\n-----END KEY-----');
    });

    it('should decode base64 PEM', () => {
      const pem = '-----BEGIN KEY-----\ncontent\n-----END KEY-----';
      const encoded = Buffer.from(pem).toString('base64');
      const result = (WechatPaymentProvider as any).normalizePem(encoded);
      expect(result).toBe(pem);
    });

    it('should return PEM with real newlines unchanged', () => {
      const input = '-----BEGIN KEY-----\ncontent\n-----END KEY-----';
      const result = (WechatPaymentProvider as any).normalizePem(input);
      expect(result).toBe(input);
    });
  });

  describe('formatTimeExpire', () => {
    it('should format as RFC 3339 seconds precision with +08:00', () => {
      // Use a fixed date to test formatting
      const date = new Date('2026-07-26T14:00:00+08:00');
      const result = (WechatPaymentProvider as any).formatTimeExpire(date);
      expect(result).toBe('2026-07-26T14:00:00+08:00');
    });

    it('should format with padded values', () => {
      const date = new Date('2026-01-05T08:05:09+08:00');
      const result = (WechatPaymentProvider as any).formatTimeExpire(date);
      expect(result).toBe('2026-01-05T08:05:09+08:00');
    });
  });

  describe('createPayment', () => {
    it('should call WeChat Native payment API and return codeUrl + prepayId', async () => {
      mockNativePost.mockResolvedValueOnce({
        data: { code_url: 'weixin://wxpay/bizpayurl?pr=abc123', prepay_id: 'prepay_001' },
      });

      const provider = new WechatPaymentProvider(validEnv as any);
      const result = await provider.createPayment({
        orderNo: 'RC20260726USER00123456',
        amount: 5000,
        userId: 'user-1',
        description: 'Flow123 AI创作平台充值 - 50元',
        notifyUrl: 'https://www.flow123.com/api/recharge/notify/wechat',
        timeExpire: '2026-07-26T16:00:00+08:00',
      });

      expect(result.codeUrl).toBe('weixin://wxpay/bizpayurl?pr=abc123');
      expect(result.prepayId).toBe('prepay_001');
      expect(mockNativePost).toHaveBeenCalledTimes(1);
    });

    it('should retry on network errors (exponential backoff)', async () => {
      mockNativePost
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce({
          data: { code_url: 'weixin://wxpay/bizpayurl?pr=retry', prepay_id: 'prepay_002' },
        });

      const provider = new WechatPaymentProvider(validEnv as any);
      const result = await provider.createPayment({
        orderNo: 'RC20260726USER00123456',
        amount: 5000,
        userId: 'user-1',
        description: 'Flow123 AI创作平台充值 - 50元',
        notifyUrl: 'https://www.flow123.com/api/recharge/notify/wechat',
        timeExpire: '2026-07-26T16:00:00+08:00',
      });

      expect(result.codeUrl).toBe('weixin://wxpay/bizpayurl?pr=retry');
      expect(mockNativePost).toHaveBeenCalledTimes(3);
    });
  });

  describe('queryOrder', () => {
    it('should query WeChat order and return trade state', async () => {
      mockOutTradeNoGet.mockResolvedValueOnce({
        data: {
          trade_state: 'SUCCESS',
          trade_state_desc: '支付成功',
          transaction_id: '4200001234567890',
          amount: { total: 5000, payer_total: 5000 },
          payer: { openid: 'oTest123456' },
        },
      });

      const provider = new WechatPaymentProvider(validEnv as any);
      const result = await provider.queryOrder('RC20260726USER00123456');

      expect(result.tradeState).toBe('SUCCESS');
      expect(result.tradeStateDesc).toBe('支付成功');
      expect(result.transactionId).toBe('4200001234567890');
      expect(result.amount).toBe(5000);
    });
  });

  describe('closePayment', () => {
    it('should call WeChat close order API', async () => {
      mockClosePost.mockResolvedValueOnce({ data: {} });

      const provider = new WechatPaymentProvider(validEnv as any);
      await provider.closePayment('RC20260726USER00123456');

      expect(mockClosePost).toHaveBeenCalledWith('RC20260726USER00123456', { mchid: '1234567890' });
    });
  });

  describe('parseNotify', () => {
    it('should decrypt callback body and return NotifyResult', async () => {
      mockDecrypt.mockReturnValueOnce(JSON.stringify({
        out_trade_no: 'RC20260726USER00123456',
        transaction_id: '4200001234567890',
        trade_state: 'SUCCESS',
        trade_state_desc: '支付成功',
        amount: { total: 5000 },
        payer: { openid: 'oTest123456' },
        appid: 'wx1234567890abcdef',
        mchid: '1234567890',
      }));

      const provider = new WechatPaymentProvider(validEnv as any);
      const result = await provider.parseNotify(
        {
          'content-type': 'application/json',
          'wechatpay-nonce': 'test-nonce-001',
          'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)),
          'wechatpay-serial': 'PUB_KEY_ID_01',
          'wechatpay-signature': 'mock-signature',
        },
        Buffer.from(JSON.stringify({ resource: { ciphertext: 'encrypted', nonce: 'nonce1', associated_data: 'ad1' } })),
      );

      expect(result.outTradeNo).toBe('RC20260726USER00123456');
      expect(result.transactionId).toBe('4200001234567890');
      expect(result.tradeState).toBe('SUCCESS');
      expect(result.amount).toBe(5000);
      expect(result.appid).toBe('wx1234567890abcdef');
      expect(result.mchid).toBe('1234567890');
    });

    it('should reject expired timestamp (replay attack prevention)', async () => {
      const provider = new WechatPaymentProvider(validEnv as any);
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600);

      await expect(
        provider.parseNotify(
          {
            'content-type': 'application/json',
            'wechatpay-nonce': 'test-nonce-002',
            'wechatpay-timestamp': oldTimestamp,
            'wechatpay-serial': 'PUB_KEY_ID_01',
            'wechatpay-signature': 'mock-signature',
          },
          Buffer.from('{}'),
        ),
      ).rejects.toThrow(/timestamp/i);
    });
  });
});
