import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PageContainer, ProTable, ModalForm, ProFormText, ProFormTextArea, ProFormDigit,
  ProFormSelect, ProFormSwitch, ProFormRadio, ProFormDependency,
} from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Button, Form, Popconfirm, Radio, Switch, Tabs } from 'antd';
import { adminVideoWorkApi } from '@/api/adminApi';
import { toFlowaiUrl } from '@/api/videoWorkApi';
import { confirmUpload } from '@/api/storageApi';
import { probeVideoFile } from '@/pages/admin/utils/probeVideoFile';
import { uploadToPresignedPost } from '@/pages/admin/utils/uploadToPresignedPost';
import { parseCanvasRef } from '@/pages/admin/utils/parseCanvasRef';

interface VideoWorkRow {
  id: string;
  title: string;
  description: string | null;
  authorName: string;
  categoryId: string | null;
  videoKey: string;
  videoMediaId: string | null;
  coverKey: string | null;
  coverUrl?: string | null;
  canvasProjectId: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  viewCount: number;
  likeCount: number;
  tags: string[];
  sortOrder: number;
  status: 'DRAFT' | 'PUBLISHED';
  allowViewProcess: boolean;
  allowClone: boolean;
  updatedAt: string;
}

interface TaxonomyRow {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

type WorkFormValues = {
  videoMediaId?: string;
  videoKey?: string;
  canvasProjectId?: string | null;
  title: string;
  description?: string;
  authorName: string;
  categoryId?: string;
  tags?: string[];
  sortOrder?: number;
  status: 'DRAFT' | 'PUBLISHED';
  allowViewProcess: boolean;
  allowClone: boolean;
  viewCount?: number;
  likeCount?: number;
};

export function VideoWorksPage() {
  return (
    <PageContainer title="视频作品">
      <Tabs
        items={[
          { key: 'works', label: '作品', children: <WorksTable /> },
          { key: 'categories', label: '视频类型', children: <TaxonomyTable noun="类型" list={adminVideoWorkApi.listCategories} create={adminVideoWorkApi.createCategory} update={adminVideoWorkApi.updateCategory} remove={adminVideoWorkApi.deleteCategory} /> },
          { key: 'tags', label: '标签池', children: <TaxonomyTable noun="标签" list={adminVideoWorkApi.listTags} create={adminVideoWorkApi.createTag} update={adminVideoWorkApi.updateTag} remove={adminVideoWorkApi.deleteTag} /> },
          { key: 'settings', label: '播放页设置', children: <CarouselSettingsCard /> },
        ]}
      />
    </PageContainer>
  );
}

function WorksTable() {
  const ref = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  useEffect(() => {
    adminVideoWorkApi.listCategories()
      .then((d) => setCategories(d as { id: string; name: string }[]))
      .catch((e: Error) => message.error(e.message));
  }, [message]);

  const toggleStatus = async (r: VideoWorkRow) => {
    const next = r.status === 'PUBLISHED' ? 'DRAFT' as const : 'PUBLISHED' as const;
    try {
      await adminVideoWorkApi.updateWork(r.id, { status: next });
      message.success(next === 'PUBLISHED' ? '已发布' : '已下架');
      ref.current?.reload();
    } catch (e) { message.error((e as Error).message); }
  };

  const columns: ProColumns<VideoWorkRow>[] = [
    { title: '标题', dataIndex: 'title' },
    { title: '类型', dataIndex: 'categoryId', render: (_, r) => (r.categoryId ? catName.get(r.categoryId) ?? '-' : '-') },
    { title: '状态', dataIndex: 'status', valueEnum: { DRAFT: { text: '草稿' }, PUBLISHED: { text: '已发布' } } },
    { title: '观看', dataIndex: 'viewCount', width: 80 },
    { title: '喜欢', dataIndex: 'likeCount', width: 80 },
    { title: '排序', dataIndex: 'sortOrder', width: 70 },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (_, r) => new Date(r.updatedAt).toLocaleString() },
    {
      title: '操作', valueType: 'option', width: 160,
      render: (_, r) => [
        <WorkFormModal key="edit" mode="edit" record={r} onDone={() => ref.current?.reload()} trigger={<a>编辑</a>} />,
        <a key="status" onClick={() => void toggleStatus(r)}>{r.status === 'PUBLISHED' ? '下架' : '发布'}</a>,
        <Popconfirm key="del" title="确认删除该作品？" onConfirm={async () => {
          try { await adminVideoWorkApi.deleteWork(r.id); message.success('已删除'); ref.current?.reload(); }
          catch (e) { message.error((e as Error).message); }
        }}>
          <a style={{ color: '#ff7875' }}>删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <ProTable<VideoWorkRow> rowKey="id" search={false} size="middle" columns={columns} actionRef={ref}
      request={async (params) => {
        const r = await adminVideoWorkApi.listWorks(params.current ?? 1, params.pageSize ?? 20) as { items: VideoWorkRow[]; total: number };
        return { data: r.items, total: r.total, success: true };
      }}
      toolBarRender={() => [
        <WorkFormModal key="create" mode="create" onDone={() => ref.current?.reload()} trigger={<Button type="primary">新增作品</Button>} />,
      ]}
    />
  );
}

function WorkFormModal({ mode, record, onDone, trigger }: {
  mode: 'create' | 'edit'; record?: VideoWorkRow; onDone: () => void; trigger: React.ReactElement;
}) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [coverKey, setCoverKey] = useState<string | undefined>(record?.coverKey ?? undefined);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // —— 成品视频上传状态机（组件常驻 trigger 宿主——重置挂 afterClose，useEffect cleanup 不会执行）——
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [video, setVideo] = useState<{ videoKey: string; videoMediaId: string; fileName: string; fileSize: number; durationSec: number | null; width: number | null; height: number | null } | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // —— 封面（提交时上传：blob 留内存 + objectURL 预览——竞态与孤儿双消除，spec §5.4）——
  const coverBlobRef = useRef<Blob | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const coverTouchedRef = useRef(false);

  // —— 源画布（可选）：输入即注册字段（防 C-1），校验结果只做回显+门禁，不写回表单值 ——
  const [canvasVerified, setCanvasVerified] = useState<{ id: string; name: string; ownerName: string | null } | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  // verifiedRef（第九轮必修1）：onChange 清 state 但**不清它**——门禁文案"画布已修改"的唯一判据。
  // 若判 canvasVerified，"校验通过→改文本"时它已被 onChange 清 null，三元式永远落到"画布不存在"（钦定文案成死分支）。
  // 只存 id（第十一轮 C4：text 是死字段已删——等价放行判据是 id 比对，不用原始文本）。
  // 已知限制：粘 URL 后校验还在飞（ref=null）时直接提交会误弹"画布不存在"，误导、登记不处理（第九轮小项3）。
  const verifiedRef = useRef<{ id: string } | null>(null);
  // 序号守卫（第九轮必修2）：canvasCheck 无 signal，关弹层/重新输入后飞行中的 resolve 落定会把已重置状态写回来
  const canvasCheckSeq = useRef(0);
  // 渲染期"未改动"判定（红/黄互斥的事实源）——与 onFinish 用同一判据：文本 === record 初值。
  // Form.useWatch 本仓首次使用（rc-field-form 2.7.1 传 form 实例路径已验：useWatch.js:46 _init 校验 + :81 effect 主动读初值）——
  // 渲染期读值与 onFinish 同判据必须它；ProFormDependency 的 render-prop 拿不到 onFinish 闭包，替代不了
  const canvasTextWatch = Form.useWatch('canvasProjectId', form) ?? '';
  const initialCanvasText = mode === 'edit' && record?.canvasProjectId ? record.canvasProjectId : '';
  const canvasUntouched = String(canvasTextWatch).trim() === initialCanvasText.trim();

  const checkCanvas = async (text: string, resetSwitches = true) => {
    const id = parseCanvasRef(text);
    if (!id) {
      // 空文本也作废在飞校验（第十轮 B1：否则"粘 p1→blur 在飞→清空→再 blur"后旧请求 resolve 会把已清空表单写回"已验证"）
      canvasCheckSeq.current++;
      verifiedRef.current = null;
      setCanvasVerified(null); setCanvasError(null);
      form.setFieldsValue({ allowViewProcess: false, allowClone: false }); // 收窄落 false 落点①：清空=放弃画布，防 true 残留撞 400
      return;
    }
    const seq = ++canvasCheckSeq.current;
    try {
      const c = await adminVideoWorkApi.canvasCheck(id);
      if (seq !== canvasCheckSeq.current) return; // 过期校验（已关弹层/已重新输入）——勿写回
      verifiedRef.current = { id: c.id };
      setCanvasVerified({ id: c.id, name: c.name, ownerName: c.ownerName });
      setCanvasError(null);
    } catch {
      if (seq !== canvasCheckSeq.current) return;
      verifiedRef.current = null;
      setCanvasVerified(null); setCanvasError('画布不存在');
      // 收窄落 false 落点②（第十一轮②再收窄）：仅用户主动输入坏 ID（blur 路径）才落——预填校验失败
      //（onOpenChange 传 resetSwitches=false）不动存量开关：黄字承诺"保留原关联"，落 false 会静默关掉
      // 存量开关（文案骗人）；开关保持 true 无害——后端 updateWork flags 用 merged（existing.canvasProjectId
      // 已存非空 → 不 400）。catch 同时承担"用户填坏 ID"与"预填画布已失效"两语义，靠此参数分治。
      if (resetSwitches) form.setFieldsValue({ allowViewProcess: false, allowClone: false });
    }
  };

  const handleUpload = async (file: File) => { // 封面手动上传（现有路径）
    setUploading(true);
    try {
      const { key } = await adminVideoWorkApi.uploadCover(file);
      setCoverKey(key); coverTouchedRef.current = true; // 手选后抽帧 blob 不再使用
      if (coverPreview) URL.revokeObjectURL(coverPreview);
      setCoverPreview(null);
      message.success('已上传，保存后生效');
    } catch (e) { message.error((e as Error).message); }
    finally { setUploading(false); }
  };

  const handleVideoSelected = async (file: File) => {
    // ac 提到最前（Task 10 审查 I-1）：probe 窗口内关弹层时 afterClose 的 abort() 不能打在 null 上——
    // 否则 probe 落定后流水线照常启动（不可中止的隐形直传 + setVideo 残留到重开弹层，违背"重开不残留"不变量）
    const ac = new AbortController(); abortRef.current = ac; // signal 贯穿 presign/直传/confirm 三段
    // 前置拦截（中文即时提示，别等 presign 400——那是 "Bad Request Exception" 无细节）
    if (file.type !== 'video/mp4') { message.error('仅支持 MP4 格式'); return; }
    if (file.size > 1024 * 1024 * 1024) { message.error('视频不得超过 1GB'); return; }
    const probe = await probeVideoFile(file);
    if (ac.signal.aborted) return; // probe 落定时弹层已关——勿启动上传、勿写封面预览（objectURL 泄漏）
    if (!probe.ok) { message.error('浏览器无法解码，请导出 H.264 编码 MP4'); return; } // 可播放性闸门
    if (probe.coverBlob && !coverTouchedRef.current) {
      if (coverPreview) URL.revokeObjectURL(coverPreview); // 重选视频先 revoke 旧预览（Task 10 审查 M-1——afterClose 只 revoke 最新一个）
      coverBlobRef.current = probe.coverBlob;
      setCoverPreview(URL.createObjectURL(probe.coverBlob)); // 只预览，onFinish 才 uploadCover
    }
    setVideoUploading(true); setVideoProgress(0);
    try {
      const presign = await adminVideoWorkApi.presignVideo({ fileName: file.name, fileSize: file.size, fileType: file.type }, ac.signal);
      await uploadToPresignedPost({
        url: toFlowaiUrl(presign.uploadUrl), // 同源改写：桶非公开读 + dev CORS
        fields: presign.fields, file,
        onProgress: (p) => setVideoProgress(p), // 包一层钉类型（Dispatch<SetStateAction> 直赋协变侥幸，显式包一层防后续签名漂移）
        signal: ac.signal,
      });
      await confirmUpload({ fileId: presign.fileId, key: presign.key, fileSize: file.size }, ac.signal);
      setVideo({ videoKey: presign.key, videoMediaId: presign.fileId, fileName: file.name, fileSize: file.size,
        durationSec: probe.durationSec, width: probe.width, height: probe.height });
    } catch (e) {
      if (ac.signal.aborted) message.info('上传已取消');
      else message.error(`上传失败：${(e as Error).message}`);
      // 悬挂 pending 说明：直传失败未 confirm 的 Media 行不占配额、永不过期（temp 清理抓不到 uploaded）——已知台账噪音，登记后续清理
    } finally { setVideoUploading(false); abortRef.current = null; }
  };

  return (
    <ModalForm<WorkFormValues>
      title={mode === 'create' ? '新增作品' : '编辑作品'} trigger={trigger} form={form} width={640}
      onOpenChange={(open) => {
        if (!open) return;
        // 预填校验传 resetSwitches=false（第十一轮②）：死画布存量作品打开弹层即 404，若落 false 会静默关存量开关
        //——黄字承诺"保留原关联"；开关 true + 后端 merged 判据（已存 canvasProjectId 非空）不会 400，不动用户数据
        if (mode === 'edit' && record?.canvasProjectId) void checkCanvas(record.canvasProjectId, false); // 打开即回显（只回显）
      }}
      modalProps={{
        destroyOnClose: true,
        // WorkFormModal 组件常驻（trigger 挂在行/工具栏；销毁的是弹层内容非本组件），关闭重置全部上传状态；abort 防关弹层白传 1GB
        afterClose: () => {
          setCoverKey(record?.coverKey ?? undefined);
          abortRef.current?.abort();
          setVideo(null); setVideoUploading(false); setVideoProgress(0);
          if (coverPreview) URL.revokeObjectURL(coverPreview);
          setCoverPreview(null); coverBlobRef.current = null; coverTouchedRef.current = false;
          setCanvasVerified(null); setCanvasError(null); verifiedRef.current = null;
          canvasCheckSeq.current++; // 作废飞行中的 canvasCheck（其 resolve 被 seq 守卫拦下，不写回已重置状态）
        },
      }}
      initialValues={record ? {
        videoMediaId: record.videoMediaId ?? undefined,
        canvasProjectId: record.canvasProjectId ?? undefined, // 播种初值——onFinish 门禁 untouched 判据（文本===此值）的前提
        title: record.title, description: record.description ?? undefined, authorName: record.authorName,
        categoryId: record.categoryId ?? undefined, tags: record.tags, sortOrder: record.sortOrder,
        status: record.status, allowViewProcess: record.allowViewProcess, allowClone: record.allowClone,
        viewCount: record.viewCount, likeCount: record.likeCount,
      } : {
        sortOrder: 0, status: 'DRAFT', allowViewProcess: false, allowClone: false, viewCount: 0, likeCount: 0, tags: [],
      }}
      onFinish={async (v) => {
        if (mode === 'create' && !video) { message.error('请先上传成品视频'); return false; }
        const { videoKey: _vk, videoMediaId: _vm, canvasProjectId: _cp, ...rest } = v; // 画布字段从 rest 剥离——payload 是否带它由下方门禁决定；剩余值命名 rest（同 Task 10，onFinish 内 form 保留给表单实例——第九轮 A1：同名影子令 form.getFieldValue 是 undefined、每次提交 TypeError 且浏览器静默）
        const canvasText = String(_cp ?? '').trim(); // 第九轮 A1：读解构出的 _cp——此处若写 form.getFieldValue，form 是上面的剩余值对象（影子），getFieldValue 是 undefined → 每次提交 TypeError、createWork 永不被调且浏览器静默
        const parsedCanvasId = parseCanvasRef(canvasText);
        const untouched = canvasText === initialCanvasText.trim(); // 与渲染期 canvasUntouched 同判据（文本===record 初值），两处勿各算各的
        // safeFlags 兜底（第十一轮 B1）：清空画布文本若未经 blur 提交，开关可能仍 true → 后端 assertProcessFlags 400
        // 且开关禁用成死结（disabled+true 点不动，须重粘有效画布才脱困）。当前路径不可达——本表单无
        // htmlType="submit" 按钮、Enter 不触发隐式提交（pro-form Submitter 是 onClick→submit()，es/components/
        // Submitter/index.js:55-65 已核）；覆盖式兜底不依赖事件时序，为将来加提交按钮保险。必须是 payload 覆盖
        // 而非 form.setFieldsValue——后者改不了本次已收集的 v，本次照样 400。
        const safeFlags = canvasText ? {} : { allowViewProcess: false, allowClone: false };
        if (!untouched && canvasText && (!canvasVerified || canvasVerified.id !== parsedCanvasId)) {
          // 等价放行（第十轮 C1）：改出去又改回已验证文本（未 blur）——verifiedRef.id 与当前解析一致即视同已验证
          //（成立前提：onChange 不清 verifiedRef——见 onChange 注释，勿在那里"顺手"清它）
          if (verifiedRef.current?.id !== parsedCanvasId) {
            // 文案判据是 verifiedRef（必修1）——canvasVerified 已被 onChange 清 null，判它则"画布已修改"永不可达
            message.error(verifiedRef.current ? '画布已修改，请重新校验' : (canvasError ?? '画布不存在，请重新校验'));
            return false;
          }
        }
        let finalCover = coverKey;
        if (mode === 'create' && !coverTouchedRef.current && coverBlobRef.current) {
          try {
            const { key } = await adminVideoWorkApi.uploadCover(new File([coverBlobRef.current], 'cover.jpg', { type: 'image/jpeg' }));
            finalCover = key;
          } catch (e) { message.error(`封面上传失败：${(e as Error).message}`); return false; } // 失败阻断——视频已 confirm 无引用属 §9② 清理范围，非遗漏
        }
        try {
          if (mode === 'create') {
            await adminVideoWorkApi.createWork({
              ...rest,
              ...safeFlags,                                                    // 第十一轮 B1 兜底：无画布文本时开关安全化 false（覆盖 rest，见门禁段注释）
              ...(untouched ? {} : { canvasProjectId: parsedCanvasId ?? null }), // 未动 → 省略（后端不动已存值）；动了 → 解析值（空文本=显式清除 null）
              videoKey: video!.videoKey, videoMediaId: video!.videoMediaId,
              durationSec: video!.durationSec, width: video!.width, height: video!.height,
              coverKey: finalCover ?? null,
            });
          } else if (record) {
            await adminVideoWorkApi.updateWork(record.id, {
              ...rest,
              ...safeFlags,                                                    // 第十一轮 B1 兜底：无画布文本时开关安全化 false（覆盖 rest，见门禁段注释）
              ...(untouched ? {} : { canvasProjectId: parsedCanvasId ?? null }), // 未动 → 省略（后端不动已存值）；动了 → 解析值（空文本=显式清除 null）
              coverKey: finalCover ?? null,
            });
          }
          message.success('已保存'); onDone(); return true;
        } catch (e) { message.error((e as Error).message); return false; }
      }}
    >
      {/* inline style 而非 .hidden：antd :where().ant-form input[type=file] 特异性 (0,2,1) 压 Tailwind .hidden (0,1,0) 致原生控件暴露 */}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ''; /* 复位：连续选同一文件也能触发 */ }} />

      {mode === 'create' && (
        <div className="mb-4">
          <div className="mb-1 text-sm">成品视频（上传后不可更换，更换需删除作品重建——会丢观看/喜欢数）</div>
          {/* 内联 display:none：antd :where().ant-form input[type=file] 特异性 (0,2,1) 压 Tailwind .hidden 致原生控件暴露 */}
          <input ref={videoInputRef} type="file" accept="video/mp4" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleVideoSelected(f); e.target.value = ''; /* 复位：连续选同一文件 */ }} />
          <Button onClick={() => videoInputRef.current?.click()} loading={videoUploading}>选择 MP4 文件（≤1GB）</Button>
          {videoUploading && <span className="ml-2 text-xs text-gray-500">直传中 {videoProgress}%</span>}
          {video && !videoUploading && (
            <div className="mt-1 text-xs text-gray-600">
              已上传：{video.fileName}（{(video.fileSize / 1024 / 1024).toFixed(1)}MB{video.durationSec != null ? ` / ${video.durationSec}s` : ''}{video.width != null ? ` / ${video.width}×${video.height}` : ''}）
            </div>
          )}
        </div>
      )}
      {mode === 'edit' && record && (
        <div className="mb-4 rounded bg-gray-50 p-2 text-xs text-gray-600">
          <div>当前视频：{record.durationSec != null ? `${record.durationSec}s` : '时长未知'}{record.width != null ? ` / ${record.width}×${record.height}` : ''}（上传后不可更换，更换需删除作品重建——会丢观看/喜欢数）</div>
          {/* 封面缩略图走 listAllWorks 的 presign coverUrl（裸 /flowai/+coverKey 生产 403——桶非公开读）；
              信息条只读 VideoWork 行字段，不解析 videoKey（旧域 key 可能指向已删对象） */}
          {record.coverUrl
            ? <img src={toFlowaiUrl(record.coverUrl)} alt="当前封面" style={{ height: 48, marginTop: 4 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            : <div style={{ marginTop: 4 }}>无封面</div>}
        </div>
      )}
      <ProFormText name="canvasProjectId" label="源画布（可选）" placeholder="粘贴画布 ID 或画布页 URL"
        fieldProps={{
          onBlur: (e) => void checkCanvas(e.target.value),
          // 文本改动即失效（state 清、verifiedRef 不清——必修1 的文案判据）：
          // **verifiedRef 是已验证事实的记录，不由文本变更作废**——门禁用 id 比对天然覆盖"改出去又改回"
          //（第十轮 C1 等价放行就靠这条，勿在 onChange 里"顺手"清它——看起来自然，清了等价放行静默死）。
          // 落 false **不在此处**（第十轮收窄）——edit 场景敲错字又改回原文会静默关掉存量"创作过程/克隆"开关，
          // 超出防 400 目标；落 false 只在 checkCanvas 空文本/catch 两分支（真实浏览器点确定前输入框必先 blur，
          // jsdom fireEvent.click 不自动 blur——测试显式 fireEvent.blur）。B2 两条 400 路径（清空/校验失败）照堵，
          // "改文本未重校验"路径由 onFinish 门禁拦截承担（外加 safeFlags 兜底——见 onFinish 注释）。
          // 此处 form 是组件作用域的表单实例（无 A1 影子问题——影子只在 onFinish 解构之后）
          onChange: (e) => {
            canvasCheckSeq.current++; // 文本失效即作废在飞校验（第十轮 B1 三路之一：onChange/空文本/afterClose）
            setCanvasVerified(null); setCanvasError(null);
          },
        }}
      />
      {canvasVerified && (
        <div className="mb-2 -mt-2 text-xs text-green-600">
          {/* ownerName null 分支防御性——schema.prisma:169 CanvasProject.teamId 必填 + Team.owner 必填，实际不可达（测试 mock 才走到，勿当 nullable 契约） */}
          画布：{canvasVerified.name}（{canvasVerified.ownerName ? `作者 ${canvasVerified.ownerName}` : '团队画布'}）
        </div>
      )}
      {canvasError && !canvasUntouched && <div className="mb-2 -mt-2 text-xs text-red-500">画布不存在</div>}
      {canvasError && canvasUntouched && mode === 'edit' && record?.canvasProjectId && (
        <div className="mb-2 -mt-2 text-xs text-amber-500">源画布已删除，保存将保留原关联</div>
      )}
      <ProFormText name="title" label="标题" rules={[{ required: true, message: '请输入标题' }, { max: 200, message: '最多 200 字' }]} fieldProps={{ maxLength: 200 }} />
      <ProFormTextArea name="description" label="简介" fieldProps={{ maxLength: 2000 }} rules={[{ max: 2000, message: '最多 2000 字' }]} />
      <ProFormText name="authorName" label="作者名" rules={[{ required: true, message: '请输入作者名' }, { max: 64, message: '最多 64 字' }]} fieldProps={{ maxLength: 64 }} />
      <ProFormSelect name="categoryId" label="类型" placeholder="选择类型"
        request={async () => {
          const d = await adminVideoWorkApi.listCategories() as { id: string; name: string }[];
          return d.map((c) => ({ label: c.name, value: c.id }));
        }}
      />
      <ProFormSelect name="tags" label="标签" placeholder="选择或自由输入（最多 10 个）"
        request={async () => {
          const d = await adminVideoWorkApi.listTags() as { name: string }[];
          return d.map((t) => ({ label: t.name, value: t.name }));
        }}
        fieldProps={{ mode: 'tags', maxCount: 10 }} // 标签池建议 + 自由输入（D7）
      />

      <div className="mb-4">
        <div className="mb-1 text-sm">封面（留空则用视频截帧封面）</div>
        <Button onClick={() => fileRef.current?.click()} loading={uploading}>选择文件</Button>
        {coverPreview && <img src={coverPreview} alt="封面预览" style={{ height: 48 }} className="ml-2 inline-block align-middle" />}
        <span className="ml-2 text-xs text-gray-400">{coverKey ? `已上传：${coverKey}` : coverPreview ? '将使用视频截帧作封面' : '未上传'}</span>
      </div>

      <ProFormDigit name="sortOrder" label="排序" initialValue={0} />
      <ProFormRadio.Group name="status" label="状态" options={[{ label: '草稿', value: 'DRAFT' }, { label: '已发布', value: 'PUBLISHED' }]} />

      <ProFormDependency name={['allowViewProcess']}>{/* canvasProjectId 已非依赖（noCanvas 由 canvasVerified 驱动）——留着会误导后人以为门禁仍是文本非空驱动 */}
        {({ allowViewProcess }) => {
          const noCanvas = !canvasVerified; // B3：由"校验通过"驱动，非文本非空——防乱码可点、清空残留 true 撞 assertProcessFlags 400
          return (
            <>
              <ProFormSwitch
                name="allowViewProcess" label="允许查看创作过程"
                tooltip={noCanvas ? '需先校验通过源画布' : '开启后播放页可查看创作过程快照'}
                disabled={noCanvas}
                fieldProps={{
                  // rc-switch 运行时透传 aria-*，ProFormSwitch fieldProps 类型未收录——as any 收敛
                  'aria-label': '允许查看创作过程',
                  onChange: (checked: boolean) => {
                    if (!checked) form.setFieldsValue({ allowClone: false }); // 强制关（后端 400 校验的前端半边）
                  },
                } as any}
              />
              <ProFormSwitch
                name="allowClone" label="允许克隆"
                tooltip={noCanvas ? '需先校验通过源画布' : !allowViewProcess ? '需先开启「允许查看创作过程」' : '开启后播放页可一键克隆到我的画布'}
                disabled={noCanvas || !allowViewProcess}
                fieldProps={{ 'aria-label': '允许克隆' } as any}
              />
            </>
          );
        }}
      </ProFormDependency>

      <ProFormDigit name="viewCount" label="观看数（后台可调）" initialValue={0} />
      <ProFormDigit name="likeCount" label="喜欢数（后台可调）" initialValue={0} />
    </ModalForm>
  );
}

// —— 类型 / 标签管理（同构轻量 CRUD，spec §5.6） ——

function TaxonomyTable({ noun, list, create, update, remove }: {
  noun: string;
  list: () => Promise<unknown>;
  create: (d: unknown) => Promise<unknown>;
  update: (id: string, d: unknown) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}) {
  const ref = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  const columns: ProColumns<TaxonomyRow>[] = [
    { title: '名称', dataIndex: 'name' },
    { title: '排序', dataIndex: 'sortOrder', width: 70 },
    {
      title: '启用', dataIndex: 'active', width: 80,
      render: (_, r) => (
        <Switch checked={r.active} onChange={(checked) => {
          void update(r.id, { active: checked }).then(() => { message.success(checked ? '已启用' : '已禁用'); ref.current?.reload(); }).catch((e: Error) => message.error(e.message));
        }} />
      ),
    },
    {
      title: '操作', valueType: 'option', width: 120,
      render: (_, r) => [
        <TaxonomyFormModal key="edit" noun={noun} mode="edit" record={r} create={create} update={update} onDone={() => ref.current?.reload()} trigger={<a>编辑</a>} />,
        <Popconfirm key="del" title={`确认删除该${noun}？`} onConfirm={async () => {
          try { await remove(r.id); message.success('已删除'); ref.current?.reload(); }
          catch (e) { message.error((e as Error).message); }
        }}>
          <a style={{ color: '#ff7875' }}>删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <ProTable<TaxonomyRow> rowKey="id" search={false} size="middle" columns={columns} actionRef={ref}
      request={async () => { const d = await list() as TaxonomyRow[]; return { data: d, success: true, total: d.length }; }}
      toolBarRender={() => [
        <TaxonomyFormModal key="create" noun={noun} mode="create" create={create} update={update} onDone={() => ref.current?.reload()} trigger={<Button type="primary">{`新增${noun}`}</Button>} />,
      ]}
    />
  );
}

function TaxonomyFormModal({ noun, mode, record, create, update, onDone, trigger }: {
  noun: string; mode: 'create' | 'edit'; record?: TaxonomyRow;
  create: (d: unknown) => Promise<unknown>; update: (id: string, d: unknown) => Promise<unknown>;
  onDone: () => void; trigger: React.ReactElement;
}) {
  const { message } = AntdApp.useApp();
  return (
    <ModalForm<TaxonomyRow>
      title={mode === 'create' ? `新增${noun}` : `编辑${noun}`} trigger={trigger}
      modalProps={{ destroyOnClose: true }}
      initialValues={record ?? { sortOrder: 0, active: true }}
      onFinish={async (v) => {
        try {
          const payload = { name: v.name?.trim(), sortOrder: v.sortOrder, active: v.active };
          if (mode === 'create') await create(payload);
          else if (record) await update(record.id, payload);
          message.success('已保存'); onDone(); return true;
        } catch (e) { message.error((e as Error).message); return false; }
      }}
    >
      <ProFormText name="name" label="名称" rules={[{ required: true, message: '请输入名称' }, { max: 64, message: '最多 64 字' }]} fieldProps={{ maxLength: 64 }} />
      <ProFormDigit name="sortOrder" label="排序" initialValue={0} />
      <ProFormSwitch name="active" label="启用" initialValue={true} />
    </ModalForm>
  );
}

// —— 轮播设置卡片（spec §5.6：carouselEnabled + carouselScope，读写 /settings） ——

type VideoWorkSettings = { carouselEnabled: boolean; carouselScope: 'all' | 'category' };

function CarouselSettingsCard() {
  const { message } = AntdApp.useApp();
  const [settings, setSettings] = useState<VideoWorkSettings | null>(null);

  useEffect(() => {
    adminVideoWorkApi.getSettings()
      .then((d) => setSettings(d as VideoWorkSettings))
      .catch((e: Error) => message.error(e.message));
  }, [message]);

  // antd Form 无 initialValue、initialValues 只在首挂载生效——异步到达的 getSettings 数据必须在渲染 Form 前就位（plan 第十二轮 m1）
  if (!settings) return null;

  return (
    <Form
      layout="vertical" style={{ maxWidth: 420 }} initialValues={settings}
      onFinish={async (v) => {
        try {
          await adminVideoWorkApi.updateSettings(v);
          message.success('已保存'); setSettings(v);
        } catch (e) { message.error((e as Error).message); }
      }}
    >
      <Form.Item name="carouselEnabled" label="轮播开启" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name="carouselScope" label="轮播范围">
        <Radio.Group options={[{ label: '全部作品', value: 'all' }, { label: '同类型', value: 'category' }]} />
      </Form.Item>
      <Button type="primary" htmlType="submit">保存设置</Button>
    </Form>
  );
}

export default VideoWorksPage;
