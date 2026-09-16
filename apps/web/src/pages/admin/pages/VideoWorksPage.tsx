import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PageContainer, ProTable, ModalForm, ProFormText, ProFormTextArea, ProFormDigit,
  ProFormSelect, ProFormSwitch, ProFormRadio, ProFormDependency,
} from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Button, Form, Popconfirm, Radio, Switch, Tabs } from 'antd';
import { adminVideoWorkApi } from '@/api/adminApi';

interface VideoWorkRow {
  id: string;
  title: string;
  description: string | null;
  authorName: string;
  categoryId: string | null;
  videoKey: string;
  videoMediaId: string | null;
  coverKey: string | null;
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

// 对齐 CandidateMedia（shared/types/video-work.ts）
interface CandidateItem {
  id: string;
  key: string;
  projectId: string | null;
  canvasExists: boolean;
  thumbnailKey: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  previewUrl: string | null;
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
  const candRef = useRef<Map<string, CandidateItem>>(new Map());
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try { const { key } = await adminVideoWorkApi.uploadCover(file); setCoverKey(key); message.success('已上传，保存后生效'); }
    catch (e) { message.error((e as Error).message); }
    finally { setUploading(false); }
  };

  return (
    <ModalForm<WorkFormValues>
      title={mode === 'create' ? '新增作品' : '编辑作品'} trigger={trigger} form={form} width={640}
      modalProps={{
        destroyOnClose: true,
        // 组件常驻（trigger 挂在行/工具栏），关闭时重置上传 state（HomeBannersPage 同款）
        afterClose: () => setCoverKey(record?.coverKey ?? undefined),
      }}
      initialValues={record ? {
        videoMediaId: record.videoMediaId ?? undefined,
        canvasProjectId: record.canvasProjectId ?? undefined, // 供 ProFormDependency 判两开关可用性
        title: record.title, description: record.description ?? undefined, authorName: record.authorName,
        categoryId: record.categoryId ?? undefined, tags: record.tags, sortOrder: record.sortOrder,
        status: record.status, allowViewProcess: record.allowViewProcess, allowClone: record.allowClone,
        viewCount: record.viewCount, likeCount: record.likeCount,
      } : {
        sortOrder: 0, status: 'DRAFT', allowViewProcess: false, allowClone: false, viewCount: 0, likeCount: 0, tags: [],
      }}
      onFinish={async (v) => {
        if (!v.videoKey) { message.error('请先选择候选视频'); return false; }
        try {
          const payload = { ...v, coverKey: coverKey ?? null };
          if (mode === 'create') await adminVideoWorkApi.createWork(payload);
          else if (record) await adminVideoWorkApi.updateWork(record.id, payload);
          message.success('已保存'); onDone(); return true;
        } catch (e) { message.error((e as Error).message); return false; }
      }}
    >
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ''; /* 复位：连续选同一文件也能触发 */ }} />

      <ProFormSelect
        name="videoMediaId" label="候选视频" placeholder="从候选池选择"
        fieldProps={{
          showSearch: true,
          optionFilterProp: 'label',
          // 缩略图预览（plan 字段 1）
          optionRender: (option) => {
            const c = option.data as CandidateItem & { label?: string };
            return (
              <span className="flex items-center gap-2">
                {c.previewUrl ? <img src={c.previewUrl} alt="" style={{ height: 24 }} /> : null}
                <span>{String(option.label ?? '')}</span>
              </span>
            );
          },
          onChange: (id: string) => {
            const c = candRef.current.get(id);
            if (!c) return;
            // 选中后回填 videoKey/videoMediaId/canvasProjectId/durationSec/width/height/coverKey 兜底（plan 字段 1）
            form.setFieldsValue({
              videoKey: c.key,
              canvasProjectId: c.canvasExists ? c.projectId : null,
              durationSec: c.durationSec ?? undefined,
              width: c.width ?? undefined,
              height: c.height ?? undefined,
            });
            setCoverKey((prev) => prev ?? c.thumbnailKey ?? undefined);
          },
        }}
        request={async () => {
          const r = await adminVideoWorkApi.listCandidates(1) as { items: CandidateItem[]; total: number };
          candRef.current = new Map(r.items.map((c) => [c.id, c]));
          return r.items.map((c) => ({
            label: c.canvasExists ? c.key : `${c.key}（画布已删除）`, // canvasExists=false 标注（plan 字段 1）
            value: c.id,
            disabled: !c.canvasExists,
          }));
        }}
      />
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
        <div className="mb-1 text-sm">封面（留空使用视频缩略图）</div>
        <Button onClick={() => fileRef.current?.click()} loading={uploading}>选择文件</Button>
        <span className="ml-2 text-xs text-gray-400">{coverKey ? `已上传：${coverKey}` : '未上传'}</span>
      </div>

      <ProFormDigit name="sortOrder" label="排序" initialValue={0} />
      <ProFormRadio.Group name="status" label="状态" options={[{ label: '草稿', value: 'DRAFT' }, { label: '已发布', value: 'PUBLISHED' }]} />

      {/* 无 canvasProjectId（未选候选或候选无画布）两开关禁用 + allowClone 依赖 allowViewProcess（plan 字段 10）：
          联动承重机制是显式订阅——ProFormDependency 包裹后依赖值变化重跑本字段 props，裸 form.getFieldValue 读陈旧值 */}
      <ProFormDependency name={['canvasProjectId']}>
        {({ canvasProjectId }) => {
          const noCanvas = !canvasProjectId;
          return (
            <>
              <ProFormSwitch
                name="allowViewProcess" label="允许查看创作过程"
                tooltip={noCanvas ? '需先选择有画布的候选视频' : '开启后播放页可查看创作过程快照'}
                disabled={noCanvas}
                fieldProps={{
                  // rc-switch 运行时透传 aria-*，ProFormSwitch fieldProps 类型未收录——as any 收敛
                  'aria-label': '允许查看创作过程',
                  onChange: (checked: boolean) => {
                    if (!checked) form.setFieldsValue({ allowClone: false }); // 强制关（后端 400 校验的前端半边）
                  },
                } as any}
              />
              <ProFormDependency name={['allowViewProcess']}>
                {({ allowViewProcess }) => (
                  <ProFormSwitch
                    name="allowClone" label="允许克隆"
                    tooltip={noCanvas ? '需先选择有画布的候选视频' : !allowViewProcess ? '需先开启「允许查看创作过程」' : '开启后播放页可一键克隆到我的画布'}
                    disabled={noCanvas || !allowViewProcess}
                    fieldProps={{ 'aria-label': '允许克隆' } as any} // 同上：类型未收录 aria-*，运行时透传
                  />
                )}
              </ProFormDependency>
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
