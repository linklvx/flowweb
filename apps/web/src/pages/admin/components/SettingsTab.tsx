import { useState, useEffect, useCallback } from 'react';
import {
  fetchAllSettings,
  saveSettings,
  type SettingEntry,
  type SettingGroup,
} from '@/api/adminApi';

// ---- 字段元数据 ----

interface FieldMeta {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
  placeholder?: string;
  /** 敏感字段：不可编辑，仅显示是否已配置 */
  sensitive?: boolean;
}

const FIELD_META: Record<SettingGroup, { title: string; description?: string; fields: FieldMeta[] }> = {
  wechat_pay: {
    title: '微信支付设置',
    description: 'API 密钥、私钥、证书等敏感凭证需在服务器 ~/flowweb/apps/api/.env 中配置',
    fields: [
      { key: 'WECHAT_PAY_APP_ID', label: 'App ID', type: 'text' },
      { key: 'WECHAT_PAY_MCH_ID', label: '商户号 (Mch ID)', type: 'text' },
      { key: 'WECHAT_PAY_API_V3_KEY', label: 'API V3 密钥', type: 'password', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
      { key: 'WECHAT_PAY_MERCHANT_SERIAL_NO', label: '商户证书序列号', type: 'text' },
      { key: 'WECHAT_PAY_PRIVATE_KEY', label: '商户私钥 (PEM)', type: 'textarea', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
      { key: 'WECHAT_PAY_MERCHANT_CERT', label: '商户证书 (PEM)', type: 'textarea', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
      { key: 'WECHAT_PAY_PUBLIC_KEY_ID', label: '平台公钥 ID', type: 'text' },
      { key: 'WECHAT_PAY_PUBLIC_KEY', label: '平台公钥 (PEM)', type: 'textarea', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
      { key: 'WECHAT_PAY_NOTIFY_URL', label: '支付回调地址', type: 'text', placeholder: 'https://www.flow123.com/api/recharge/notify' },
    ],
  },
  sms: {
    title: '短信 SMS 设置',
    description: 'SecretId / SecretKey 需在服务器 ~/flowweb/apps/api/.env 中配置',
    fields: [
      { key: 'TENCENT_SMS_SECRET_ID', label: 'SecretId', type: 'text', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
      { key: 'TENCENT_SMS_SECRET_KEY', label: 'SecretKey', type: 'password', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
      { key: 'TENCENT_SMS_SDK_APP_ID', label: 'SDK App ID', type: 'text' },
      { key: 'TENCENT_SMS_TEMPLATE_ID', label: '模板 ID', type: 'text' },
      { key: 'TENCENT_SMS_SIGN_NAME', label: '签名名称', type: 'text' },
    ],
  },
  wechat_login: {
    title: '微信扫码登录设置',
    fields: [
      { key: 'WECHAT_APP_ID', label: 'App ID', type: 'text' },
      { key: 'WECHAT_APP_SECRET', label: 'App Secret', type: 'password', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
    ],
  },
};

const GROUPS: SettingGroup[] = ['wechat_pay', 'sms', 'wechat_login'];
const GROUP_LABELS: Record<SettingGroup, string> = {
  wechat_pay: '微信支付',
  sms: '短信SMS',
  wechat_login: '微信扫码登录',
};

export function SettingsTab() {
  const [activeGroup, setActiveGroup] = useState<SettingGroup>('wechat_pay');
  const [allSettings, setAllSettings] = useState<Record<SettingGroup, SettingEntry[]>>({
    wechat_pay: [],
    sms: [],
    wechat_login: [],
  });
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setMessage(null);
    fetchAllSettings()
      .then((data) => {
        setAllSettings(data);
        const vals: Record<string, string> = {};
        for (const entries of Object.values(data)) {
          for (const e of entries) {
            vals[e.key] = e.value;
          }
        }
        setEditValues(vals);
      })
      .catch(() => setMessage({ type: 'error', text: '加载配置失败' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const currentMeta = FIELD_META[activeGroup];
  const currentEntries = allSettings[activeGroup];

  const editableFields = currentMeta.fields.filter(f => !f.sensitive);
  const hasChanges = editableFields.some(
    f => (editValues[f.key] ?? '') !== (currentEntries.find(e => e.key === f.key)?.value ?? ''),
  );

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const entries: SettingEntry[] = editableFields.map(f => ({
      key: f.key,
      value: editValues[f.key] ?? '',
    }));
    try {
      await saveSettings(entries);
      setMessage({ type: 'success', text: '保存成功，请执行 pm2 restart flowweb-api 重启服务生效' });
      await load();
    } catch {
      setMessage({ type: 'error', text: '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-[#888] text-sm py-8">加载中...</div>;
  }

  return (
    <div>
      {/* 子选项卡 */}
      <div className="flex gap-2 mb-6">
        {GROUPS.map(g => (
          <button
            key={g}
            onClick={() => { setActiveGroup(g); setMessage(null); }}
            className={`px-3 py-1 rounded text-xs border border-[#444] cursor-pointer transition-colors ${
              activeGroup === g
                ? 'bg-[#4ade80]/20 text-[#4ade80] border-[#4ade80]'
                : 'bg-[#1A1A1A] text-[#888] hover:text-white'
            }`}
          >
            {GROUP_LABELS[g]}
          </button>
        ))}
      </div>

      <div className="max-w-2xl">
        <h3 className="text-sm font-semibold text-[#e2e8f0] mb-1">{currentMeta.title}</h3>
        {currentMeta.description && (
          <p className="text-xs text-[#666] mb-4">{currentMeta.description}</p>
        )}

        <div className="space-y-4">
          {currentMeta.fields.map(field => {
            const currentVal = editValues[field.key] ?? '';
            const configured = currentVal.length > 0;

            if (field.sensitive) {
              return (
                <div key={field.key}>
                  <label className="block text-xs text-[#888] mb-1.5">
                    {field.label}
                    <span className="ml-2 text-[#666]">
                      {configured ? '✓ 已配置' : '✗ 未配置'}
                    </span>
                  </label>
                  <input
                    type="password"
                    value={configured ? '••••••••' : ''}
                    disabled
                    className="w-full bg-[#111] border border-[#333] rounded-md px-3 py-2 text-sm text-[#555] font-mono cursor-not-allowed"
                    placeholder={field.placeholder}
                  />
                  <p className="mt-1 text-[11px] text-[#555]">SSH 登录服务器修改 ~/flowweb/apps/api/.env 后重启服务</p>
                </div>
              );
            }

            return (
              <div key={field.key}>
                <label className="block text-xs text-[#888] mb-1.5">{field.label}</label>
                {field.type === 'textarea' ? (
                  <textarea
                    value={currentVal}
                    onChange={e => setEditValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    rows={5}
                    className="w-full bg-[#1A1A1A] border border-[#444] rounded-md px-3 py-2 text-sm text-[#e2e8f0] font-mono resize-y focus:outline-none focus:border-[#4ade80] transition-colors"
                  />
                ) : (
                  <input
                    type={field.type}
                    value={currentVal}
                    onChange={e => setEditValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="w-full bg-[#1A1A1A] border border-[#444] rounded-md px-3 py-2 text-sm text-[#e2e8f0] font-mono focus:outline-none focus:border-[#4ade80] transition-colors"
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* 操作区 */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className={`px-4 py-1.5 rounded-md text-sm border-none cursor-pointer transition-colors ${
              hasChanges && !saving
                ? 'bg-[#4ade80]/20 text-[#4ade80] font-bold hover:bg-[#4ade80]/30'
                : 'bg-[#252525] text-[#666] cursor-not-allowed'
            }`}
          >
            {saving ? '保存中...' : '保存'}
          </button>
          {message && (
            <span className={`text-xs ${message.type === 'success' ? 'text-[#4ade80]' : 'text-red-400'}`}>
              {message.text}
            </span>
          )}
        </div>

        <p className="mt-4 text-xs text-[#666]">
          非敏感配置保存在数据库中，修改后需执行 pm2 restart flowweb-api 重启服务生效。敏感凭证仅可 SSH 登录服务器修改 ~/flowweb/apps/api/.env 文件。
        </p>
      </div>
    </div>
  );
}
