import { useEffect, useMemo, useState } from 'react';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { App as AntdApp, Button, Form, Input, Spin, Tabs, Tag } from 'antd';
import { fetchAllSettings, saveSettings, type SettingEntry, type SettingGroup } from '@/api/adminApi';

interface FieldMeta {
  key: string; label: string; type: 'text' | 'password' | 'textarea';
  placeholder?: string; sensitive?: boolean;
}

const FIELD_META: Record<SettingGroup, { title: string; description?: string; fields: FieldMeta[] }> = {
  wechat_pay: {
    title: '微信支付设置',
    description: 'API V3 密钥、商户私钥需在服务器 ~/flowweb/apps/api/.env 中配置',
    fields: [
      { key: 'WECHAT_PAY_APP_ID', label: 'App ID', type: 'text' },
      { key: 'WECHAT_PAY_MCH_ID', label: '商户号 (Mch ID)', type: 'text' },
      { key: 'WECHAT_PAY_API_V3_KEY', label: 'API V3 密钥', type: 'password', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
      { key: 'WECHAT_PAY_MERCHANT_SERIAL_NO', label: '商户证书序列号', type: 'text' },
      { key: 'WECHAT_PAY_PRIVATE_KEY', label: '商户私钥 (PEM)', type: 'textarea', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
      { key: 'WECHAT_PAY_MERCHANT_CERT', label: '商户证书 (PEM)', type: 'textarea' },
      { key: 'WECHAT_PAY_PUBLIC_KEY_ID', label: '平台公钥 ID', type: 'text' },
      { key: 'WECHAT_PAY_PUBLIC_KEY', label: '平台公钥 (PEM)', type: 'textarea' },
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
const GROUP_LABELS: Record<SettingGroup, string> = { wechat_pay: '微信支付', sms: '短信SMS', wechat_login: '微信扫码登录' };

export default function SettingsPage() {
  const [activeGroup, setActiveGroup] = useState<SettingGroup>('wechat_pay');
  const [allSettings, setAllSettings] = useState<Record<SettingGroup, SettingEntry[]>>({ wechat_pay: [], sms: [], wechat_login: [] });
  const [saving, setSaving] = useState(false);
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  // diff 基线：加载完成/切分组/保存成功后都重置，否则初始态 ''!==后端值 误判可保存
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const resetBaseline = (g: SettingGroup, all: Record<SettingGroup, SettingEntry[]>) => {
    const metas = FIELD_META[g].fields.filter((f) => !f.sensitive);
    setFormValues(Object.fromEntries(metas.map((f) => [f.key, (all[g] ?? []).find((e) => e.key === f.key)?.value ?? ''])));
  };

  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchAllSettings()
      .then((all) => { setAllSettings(all); resetBaseline('wechat_pay', all); setLoaded(true); })
      // 加载失败也要解除门控（否则永久 Spin 无反馈），降级为空表单可填写
      .catch(() => { message.error('加载配置失败'); setLoaded(true); });
  }, []);

  const meta = FIELD_META[activeGroup];
  const entries = allSettings[activeGroup] ?? [];
  const valueOf = (key: string) => entries.find((e) => e.key === key)?.value ?? '';
  const configured = (key: string) => Boolean(valueOf(key));

  const initialValues = useMemo(
    () => Object.fromEntries(meta.fields.filter((f) => !f.sensitive).map((f) => [f.key, valueOf(f.key)])),
    [activeGroup, entries], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // diff 禁用保存（无变更时 disabled）
  const hasChanges = meta.fields.some(
    (f) => !f.sensitive && (formValues[f.key] ?? '') !== (entries.find((e) => e.key === f.key)?.value ?? ''),
  );

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await saveSettings(meta.fields.filter((f) => !f.sensitive).map((f) => ({ key: f.key, value: values[f.key] ?? '' })));
      message.success('保存成功，请执行 pm2 restart flowweb-api 重启服务生效');
      // 按字段全量重建（后端不返回敏感 key；原 map 更新会让「后端原本缺席的 key」保存后 entries 仍缺席 → diff 误判有变更）
      setAllSettings((prev) => ({ ...prev, [activeGroup]: meta.fields.filter((f) => !f.sensitive).map((f) => ({ key: f.key, value: values[f.key] ?? '' })) }));
      setFormValues(Object.fromEntries(meta.fields.filter((f) => !f.sensitive).map((f) => [f.key, values[f.key] ?? '']))); // 保存成功后基线同步
    } catch (e) { message.error((e as Error).message); }
    finally { setSaving(false); }
  };

  // 首载门控：Form initialValues 仅挂载时生效，fetch 前挂载则后端值永不回填
  if (!loaded) return <PageContainer title="参数配置"><div className="flex justify-center p-16"><Spin /></div></PageContainer>;

  return (
    <PageContainer title="参数配置">
      <Tabs activeKey={activeGroup} onChange={(k) => { setActiveGroup(k as SettingGroup); form.resetFields(); resetBaseline(k as SettingGroup, allSettings); }}
        items={GROUPS.map((g) => ({ key: g, label: GROUP_LABELS[g] }))} />
      <ProCard title={meta.title} subTitle={meta.description}>
        <Form form={form} layout="vertical" initialValues={initialValues} key={activeGroup} style={{ maxWidth: 640 }}
          onValuesChange={(_, all) => setFormValues(all)}>
          {meta.fields.map((f) => (
            <Form.Item key={f.key} label={f.label} name={f.sensitive ? undefined : f.key}>
              {f.sensitive ? (
                <Tag color={configured(f.key) ? 'green' : 'default'}>{configured(f.key) ? '✓ 已配置（在服务器 .env 中管理）' : '✗ 未配置'}</Tag>
              ) : f.type === 'textarea' ? (
                <Input.TextArea rows={3} placeholder={f.placeholder} />
              ) : f.type === 'password' ? (
                <Input.Password placeholder={f.placeholder} />
              ) : (
                <Input placeholder={f.placeholder} />
              )}
            </Form.Item>
          ))}
          <Button type="primary" loading={saving} disabled={!hasChanges} onClick={handleSave}>保存</Button>
          <div className="mt-4 text-xs opacity-60">非敏感配置保存在数据库中，修改后需执行 pm2 restart flowweb-api 重启服务生效。敏感凭证仅可 SSH 登录服务器修改 ~/flowweb/apps/api/.env 文件。</div>
        </Form>
      </ProCard>
    </PageContainer>
  );
}
