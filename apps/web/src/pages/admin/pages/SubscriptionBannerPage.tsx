import { useEffect, useRef, useState } from 'react';
import { PageContainer, ProCard, ProForm, ProFormText, ProFormSwitch, ProFormDateTimePicker } from '@ant-design/pro-components';
import { App as AntdApp, Button } from 'antd';
import dayjs from 'dayjs';
import { subscriptionApi } from '@/api/subscriptionApi';
import type { AdminBannerData } from '@flowweb/shared';

export default function SubscriptionBannerPage() {
  const [banner, setBanner] = useState<AdminBannerData | null>(null);
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [form] = ProForm.useForm();
  const fileRef = useRef<HTMLInputElement>(null);
  const { message } = AntdApp.useApp();

  useEffect(() => {
    subscriptionApi.getAdminBanner().then((b) => {
      setBanner(b);
      setImageKey(b?.backgroundImageKey ?? null);
    });
  }, []);

  // 上传 key 与外链 URL 互斥（填了 URL 清 key，反之亦然）
  const handleUpload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) { message.error('图片不能超过 2MB'); return; } // 2MB（home-banner 才是 5MB）
    setUploading(true);
    try {
      const { imageKey: key } = await subscriptionApi.uploadBannerImage(file);
      setImageKey(key);
      form.setFieldValue('backgroundImageUrl', ''); // 互斥：清外链
      message.success('图片已上传，保存后生效');
    } catch (e) { message.error((e as Error).message); }
    finally { setUploading(false); }
  };

  if (!banner) return <PageContainer title="订阅 Banner 设置" />;

  return (
    <PageContainer title="订阅 Banner 设置">
      <ProCard style={{ maxWidth: 640 }}>
        <div className="mb-4">
          <div className="mb-1 text-sm">背景图（multipart 后端中转，≤2MB，jpg/png/webp）</div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
          <Button onClick={() => fileRef.current?.click()} loading={uploading}>选择文件</Button>
          <span className="ml-2 text-xs opacity-60">{imageKey ? `已上传：${imageKey}` : '未上传'}</span>
          {banner.backgroundImageUrl && !imageKey && (
            <div className="mt-2"><img src={banner.backgroundImageUrl} alt="预览" style={{ maxHeight: 60 }} /></div>
          )}
        </div>
        <ProForm
          form={form}
          initialValues={{
            title: banner.title, subtitle: banner.subtitle,
            backgroundImageUrl: banner.backgroundImageUrl ?? undefined,
            countdownEndAt: banner.countdownEndAt ? dayjs(banner.countdownEndAt) : undefined,
            autoExtend: banner.autoExtend, isActive: banner.isActive,
          }}
          submitter={{ searchConfig: { submitText: '保存' } }}
          onFinish={async (v: any) => {
            try {
              const countdownEndAt = v.countdownEndAt ? dayjs(v.countdownEndAt).toISOString() : null;
              // 后端校验：autoExtend=true 必须有 countdownEndAt —— 前端联动拦截
              if (v.autoExtend && !countdownEndAt) { message.error('开启自动顺延必须设置倒计时截止时间'); return false; }
              await subscriptionApi.updateBanner({
                title: v.title, subtitle: v.subtitle,
                backgroundImageKey: imageKey,
                backgroundImageUrl: v.backgroundImageUrl || null,
                countdownEndAt, autoExtend: v.autoExtend, isActive: v.isActive,
              });
              message.success('已保存');
              // 保存后重载回显（服务端归一化结果，如 key 优先合并）——与 updateBanner 同一 try
              const fresh = await subscriptionApi.getAdminBanner();
              if (fresh) { setBanner(fresh); setImageKey(fresh.backgroundImageKey ?? null); }
              return true;
            } catch (e) { message.error((e as Error).message); return false; }
          }}
        >
          <ProFormText name="title" label="标题" fieldProps={{ maxLength: 64 }} rules={[{ required: true }]} /> {/* schema VarChar(64) */}
          <ProFormText name="subtitle" label="副标题" fieldProps={{ maxLength: 200 }} />
          {/* 双向互斥：key 优先级高于 URL（service normalize），手填 URL 必须清掉旧 key */}
          <ProFormText name="backgroundImageUrl" label="背景图 URL（可选，与上传互斥）"
            fieldProps={{ onChange: (e) => { if (e.target.value) setImageKey(null); } }} />
          <ProFormDateTimePicker name="countdownEndAt" label="倒计时截止（可选）" />
          <ProFormSwitch name="autoExtend" label="到期自动顺延 3 天（需设倒计时）" />
          <ProFormSwitch name="isActive" label="启用" />
        </ProForm>
      </ProCard>
    </PageContainer>
  );
}
