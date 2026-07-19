import { useState, useEffect, useRef } from 'react';
import { Button, message, Switch, DatePicker } from 'antd';
import dayjs from 'dayjs';
import { subscriptionApi } from '@/api/subscriptionApi';
import type { AdminBannerData } from '@flowweb/shared';

export function BannerManagementTab() {
  const [banner, setBanner] = useState<AdminBannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState('');
  const [uploadedImageKey, setUploadedImageKey] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [countdownEndAt, setCountdownEndAt] = useState<string | null>(null);
  const [autoExtend, setAutoExtend] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await subscriptionApi.getAdminBanner();
      if (r) {
        setBanner(r);
        setTitle(r.title || '');
        setSubtitle(r.subtitle || '');
        setBackgroundImageUrl(r.backgroundImageUrl || '');
        setUploadedImageKey(r.backgroundImageKey);
        setCountdownEndAt(r.countdownEndAt);
        setAutoExtend(r.autoExtend);
        setIsActive(r.isActive);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await subscriptionApi.updateBanner({
        title,
        subtitle,
        backgroundImageUrl: backgroundImageUrl || null,
        backgroundImageKey: uploadedImageKey,
        countdownEndAt: countdownEndAt || null,
        autoExtend,
        isActive,
      });
      message.success('已保存');
      load();
    } catch { message.error('保存失败'); }
    finally { setSaving(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) { message.error('仅支持 jpg/png/webp'); return; }
    if (file.size > 2 * 1024 * 1024) { message.error('文件 ≤ 2MB'); return; }

    try {
      const { imageKey } = await subscriptionApi.uploadBannerImage(file);
      setUploadedImageKey(imageKey);
      setUploadedFileName(file.name);
      setBackgroundImageUrl(''); // 清除 URL
      message.success('上传成功');
    } catch { message.error('上传失败'); }
  };

  const handleClearImage = () => {
    setUploadedImageKey(null);
    setUploadedFileName('');
  };

  // 通过 MinIO key 拼装预览 URL（项目统一文件代理接口）
  const getImagePreviewUrl = (key: string | null) => {
    if (!key) return null;
    return `/api/media/by-key?key=${encodeURIComponent(key)}`;
  };

  const getCountdownPreview = () => {
    if (!countdownEndAt) return null;
    const diff = new Date(countdownEndAt).getTime() - Date.now();
    if (diff <= 0) return { days: '00', hours: '00', mins: '00', secs: '00' };
    return {
      days: String(Math.floor(diff / 86400000)).padStart(2, '0'),
      hours: String(Math.floor((diff % 86400000) / 3600000)).padStart(2, '0'),
      mins: String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0'),
      secs: String(Math.floor((diff % 60000) / 1000)).padStart(2, '0'),
    };
  };

  const countdown = getCountdownPreview();

  if (loading) return <div className="text-[#888] text-sm py-8">加载中...</div>;

  return (
    <div className="flex gap-6">
      {/* 左侧表单 */}
      <div className="flex-1 max-w-lg space-y-4">
        <div>
          <label className="text-xs text-[#888] block mb-1">标题文字</label>
          <input
            className="bg-[#252525] border border-[#444] rounded px-3 py-1.5 text-sm text-white w-full"
            value={title} maxLength={64}
            onChange={e => setTitle(e.target.value)}
            placeholder="输入 Banner 标题"
          />
          <div className="text-[10px] text-[#666] mt-0.5">{title.length}/64</div>
        </div>

        <div>
          <label className="text-xs text-[#888] block mb-1">副标题文字</label>
          <input
            className="bg-[#252525] border border-[#444] rounded px-3 py-1.5 text-sm text-white w-full"
            value={subtitle} maxLength={200}
            onChange={e => setSubtitle(e.target.value)}
            placeholder="输入 Banner 副标题"
          />
          <div className="text-[10px] text-[#666] mt-0.5">{subtitle.length}/200</div>
        </div>

        <div className="border-t border-[#333] pt-4">
          <label className="text-xs text-[#888] block mb-2">背景图片</label>
          <div className="mb-2">
            <div className="text-[10px] text-[#666] mb-1">上传图片（优先）</div>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileUpload} />
            <div className="flex gap-2 items-center">
              <button
                className="px-3 py-1.5 rounded text-xs bg-[#252525] border border-[#555] text-[#ccc] hover:border-[#4ade80] transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >选择文件</button>
              {uploadedImageKey ? (
                <span className="text-xs text-[#4ade80]">
                  {uploadedFileName || '已上传'}
                  <button className="ml-2 text-[#888] hover:text-red-400" onClick={handleClearImage}>✕</button>
                </span>
              ) : (
                <span className="text-[10px] text-[#666]">jpg/png/webp, ≤2MB</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#666] mb-1">或输入外链 URL</div>
            <input
              className="bg-[#252525] border border-[#444] rounded px-3 py-1.5 text-sm text-white w-full"
              value={backgroundImageUrl}
              onChange={e => { setBackgroundImageUrl(e.target.value); if (e.target.value) { setUploadedImageKey(null); setUploadedFileName(''); } }}
              placeholder="https://..."
            />
          </div>
        </div>

        <div className="border-t border-[#333] pt-4">
          <label className="text-xs text-[#888] block mb-2">倒计时设置</label>
          <div className="flex gap-3 items-end">
            <div>
              <div className="text-[10px] text-[#666] mb-1">截止日期时间 (UTC)</div>
              <DatePicker
                showTime value={countdownEndAt ? dayjs(countdownEndAt) : null}
                onChange={(d) => setCountdownEndAt(d?.toISOString() ?? null)}
                disabledDate={(d) => d && d.isBefore(dayjs())}
                placeholder="选择截止时间"
              />
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch checked={autoExtend} onChange={setAutoExtend} disabled={!countdownEndAt} size="small" />
              <span className="text-xs text-[#ccc]">自动延期（归零后+3天）</span>
            </div>
          </div>
          {autoExtend && !countdownEndAt && (
            <div className="text-[11px] text-yellow-500 mt-1">启用自动延期需要设置截止时间</div>
          )}
        </div>

        <div className="border-t border-[#333] pt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onChange={setIsActive} size="small" />
            <span className="text-xs text-[#ccc]">启用 Banner</span>
          </div>
          <Button type="primary" loading={saving} onClick={handleSave}
            disabled={autoExtend && !countdownEndAt}
            style={{ backgroundColor: '#4ade80', borderColor: '#4ade80', color: '#000' }}
          >保存</Button>
        </div>
      </div>

      {/* 右侧预览 */}
      <div className="flex-1">
        <div className="text-xs text-[#888] mb-2">实时预览 — VIP Modal 顶部</div>
        <div
          className="w-full rounded-xl overflow-hidden flex items-center justify-between px-6 py-5"
          style={{
            background: (uploadedImageKey || backgroundImageUrl)
              ? undefined
              : 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
            backgroundImage: (() => {
              const url = getImagePreviewUrl(uploadedImageKey) || backgroundImageUrl;
              return url ? `url(${url})` : undefined;
            })(),
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            minHeight: 88,
          }}
        >
          <div>
            <div className="text-base font-bold text-white">{title || 'Banner 标题预览'}</div>
            <div className="text-xs text-[#a8a8a8] mt-0.5">{subtitle || 'Banner 副标题预览'}</div>
          </div>
          {countdown && (
            <div className="flex gap-2 items-center">
              {[
                { value: countdown.days, unit: '天' },
                { value: countdown.hours, unit: '时' },
                { value: countdown.mins, unit: '分' },
                { value: countdown.secs, unit: '秒' },
              ].map(({ value, unit }) => (
                <div key={unit} className="flex flex-col items-center">
                  <span className="font-mono text-lg font-bold text-white bg-[#ffffff15] rounded px-2 py-0.5 min-w-[36px] text-center">{value}</span>
                  <span className="text-[10px] text-[#888] mt-0.5">{unit}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
