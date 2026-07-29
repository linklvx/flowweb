import { useState, useEffect, useCallback } from 'react';
import {
  fetchAllSettings,
  saveSettings,
  type SettingEntry,
  type SettingGroup,
} from '@/api/adminApi';

// ---- 字段元数据定义 ----

interface FieldMeta {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
  placeholder?: string;
}

const FIELD_META: Record<SettingGroup, { title: string; fields: FieldMeta[] }> = {
  wechat_pay: {
    title: '微信支付设置',
    fields: [
      { key: 'wechat_pay.app_id', label: 'App ID', type: 'text' },
      { key: 'wechat_pay.mch_id', label: '商户号 (Mch ID)', type: 'text' },
      { key: 'wechat_pay.api_v3_key', label: 'API V3 密钥', type: 'password', placeholder: '32位随机字符串' },
      { key: 'wechat_pay.merchant_serial_no', label: '商户证书序列号', type: 'text' },
      { key: 'wechat_pay.private_key', label: '商户私钥 (PEM)', type: 'textarea', placeholder: '-----BEGIN PRIVATE KEY-----\n...' },
      { key: 'wechat_pay.merchant_cert', label: '商户证书 (PEM)', type: 'textarea', placeholder: '-----BEGIN CERTIFICATE-----\n...' },
      { key: 'wechat_pay.public_key_id', label: '平台公钥 ID', type: 'text' },
      { key: 'wechat_pay.public_key', label: '平台公钥 (PEM)', type: 'textarea', placeholder: '-----BEGIN PUBLIC KEY-----\n...' },
      { key: 'wechat_pay.notify_url', label: '支付回调地址', type: 'text', placeholder: 'https://www.flow123.com/api/recharge/notify' },
    ],
  },
  sms: {
    title: '短信 SMS 设置',
    fields: [
      { key: 'sms.secret_id', label: 'SecretId', type: 'text' },
      { key: 'sms.secret_key', label: 'SecretKey', type: 'password' },
      { key: 'sms.sdk_app_id', label: 'SDK App ID', type: 'text' },
      { key: 'sms.template_id', label: '模板 ID', type: 'text' },
      { key: 'sms.sign_name', label: '签名名称', type: 'text' },
    ],
  },
  wechat_login: {
    title: '微信扫码登录设置',
    fields: [
      { key: 'wechat_login.app_id', label: 'App ID', type: 'text' },
      { key: 'wechat_login.app_secret', label: 'App Secret', type: 'password' },
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

  const hasChanges = currentMeta.fields.some(
    f => (editValues[f.key] ?? '') !== (currentEntries.find(e => e.key === f.key)?.value ?? ''),
  );

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const entries: SettingEntry[] = currentMeta.fields.map(f => ({
      key: f.key,
      value: editValues[f.key] ?? '',
    }));
    try {
      await saveSettings(entries);
      setMessage({ type: 'success', text: '保存成功，修改后需重启服务生效' });
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

      {/* 表单 */}
      <div className="max-w-2xl">
        <h3 className="text-sm font-semibold text-[#e2e8f0] mb-4">{currentMeta.title}</h3>

        <div className="space-y-4">
          {currentMeta.fields.map(field => (
            <div key={field.key}>
              <label className="block text-xs text-[#888] mb-1.5">{field.label}</label>
              {field.type === 'textarea' ? (
                <textarea
                  value={editValues[field.key] ?? ''}
                  onChange={e => setEditValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  rows={5}
                  className="w-full bg-[#1A1A1A] border border-[#444] rounded-md px-3 py-2 text-sm text-[#e2e8f0] font-mono resize-y focus:outline-none focus:border-[#4ade80] transition-colors"
                />
              ) : (
                <input
                  type={field.type}
                  value={editValues[field.key] ?? ''}
                  onChange={e => setEditValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full bg-[#1A1A1A] border border-[#444] rounded-md px-3 py-2 text-sm text-[#e2e8f0] font-mono focus:outline-none focus:border-[#4ade80] transition-colors"
                />
              )}
            </div>
          ))}
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
          配置保存在数据库中。修改后需在服务器上重启 API 服务才能生效。
        </p>
      </div>
    </div>
  );
}
