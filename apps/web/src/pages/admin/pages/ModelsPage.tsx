import { useEffect, useState, useRef } from 'react';
import type { ReactElement } from 'react';
import { PageContainer, ProTable, ProForm, ModalForm, ProFormText, ProFormDigit, ProFormSwitch, ProFormList, ProFormSelect, ProFormDependency } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { Tabs, App as AntdApp, Popconfirm, Button, Tag } from 'antd';
import {
  fetchNodeTypes, fetchModels, createModel, updateModel, toggleModel, deleteModel, addResolution, addDuration,
  fetchPricingRules, createPricingRule, deletePricingRule,
  type NodeTypeData, type ModelData, type PricingRuleData,
} from '@/api/adminApi';

export default function ModelsPage() {
  const [nodeTypes, setNodeTypes] = useState<NodeTypeData[]>([]);
  const [activeNodeType, setActiveNodeType] = useState<string>('');
  const [models, setModels] = useState<ModelData[]>([]); // 级联下拉数据源（页面级加载一次）
  const modelsRef = useRef<ActionType>(null);
  const pricingRef = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  // 节点类型加载（原节点类型表已删，此处是唯一 setNodeTypes 来源，否则页面恒空）
  useEffect(() => {
    fetchNodeTypes().then((list) => {
      setNodeTypes(list);
      if (list.length) setActiveNodeType(list[0].id);
    });
  }, []);

  const activeNt = nodeTypes.find((nt) => nt.id === activeNodeType); // 拿 key（条件显示用）

  const modelColumns: ProColumns<ModelData>[] = [
    { title: '名称', dataIndex: 'name' },
    { title: '供应商', dataIndex: 'provider' },
    { title: '推荐', dataIndex: 'recommended', render: (_, r) => (r.recommended ? <Tag color="green">推荐</Tag> : '-') },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    { title: '分辨率', render: (_, r) => r.resolutions.map((x) => x.label).join(' / ') || '-' },
    { title: '时长', render: (_, r) => r.durations.map((x) => x.label).join(' / ') || '-' },
    { title: '状态', dataIndex: 'active', render: (_, r) => (r.active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
    {
      title: '操作', valueType: 'option',
      render: (_, record) => [
        <ModelFormModal key="edit" nodeTypeId={activeNodeType} nodeTypeKey={activeNt?.key} record={record}
          onDone={() => modelsRef.current?.reload()} trigger={<a>编辑</a>} />,
        <a key="toggle" style={{ color: '#f59e0b' }} onClick={async () => {
          try {
            await toggleModel(record.id); message.success(record.active ? '已下线' : '已上线'); modelsRef.current?.reload();
          } catch (e) { message.error((e as Error).message); }
        }}>{record.active ? '下线' : '上线'}</a>,
        <Popconfirm key="del" title="确认删除该模型？" onConfirm={async () => {
          try { await deleteModel(record.id); message.success('已删除'); modelsRef.current?.reload(); }
          catch (e) { message.error((e as Error).message); }
        }}>
          <a style={{ color: '#ff7875' }}>删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer title="模型管理">
      {nodeTypes.length > 0 && (
        <Tabs
          activeKey={activeNodeType}
          onChange={(k) => { setActiveNodeType(k); modelsRef.current?.reload(); pricingRef.current?.reload(); }}
          items={nodeTypes.map((nt) => ({ key: nt.id, label: nt.name }))}
        />
      )}
      {activeNodeType && (
        <>
          <ProTable<ModelData>
            headerTitle="模型列表" rowKey="id" search={false} size="small"
            actionRef={modelsRef}
            request={async () => {
              const d = await fetchModels(activeNodeType);
              setModels(d); // 页面级唯一 fetchModels（计费规则 request 不再重复拉）
              return { data: d, success: true, total: d.length };
            }}
            columns={modelColumns}
            toolBarRender={() => [
              <ModelFormModal key="create" nodeTypeId={activeNodeType} nodeTypeKey={activeNt?.key}
                onDone={() => modelsRef.current?.reload()} trigger={<Button type="primary">新建模型</Button>} />,
            ]}
          />
          <ProTable<PricingRuleData>
            headerTitle="计费规则" rowKey="id" search={false} size="small" style={{ marginTop: 24 }}
            actionRef={pricingRef}
            request={async () => {
              const rules = await fetchPricingRules(activeNodeType);
              return { data: rules, success: true, total: rules.length };
            }}
            columns={[
              { title: '模型', render: (_, r) => r.model?.name ?? '-' },
              { title: '分辨率', render: (_, r) => r.resolution?.label ?? '-' },
              { title: '时长', render: (_, r) => r.duration?.label ?? '-' },
              { title: '积分消耗', dataIndex: 'creditCost' },
              { title: '状态', dataIndex: 'active', render: (_, r) => (r.active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
              {
                title: '操作', valueType: 'option',
                render: (_, r) => [
                  <Popconfirm key="del" title="确认删除该规则？" onConfirm={async () => {
                    try { await deletePricingRule(r.id); message.success('已删除'); pricingRef.current?.reload(); }
                    catch (e) { message.error((e as Error).message); }
                  }}>
                    <a style={{ color: '#ff7875' }}>删除</a>
                  </Popconfirm>,
                ],
              },
            ]}
            toolBarRender={() => [
              <ModalForm key="create" title="新建计费规则" trigger={<Button type="primary">新建规则</Button>}
                modalProps={{ destroyOnClose: true }}
                onFinish={async (v: any) => {
                  try {
                    await createPricingRule({ ...v, nodeTypeId: activeNodeType });
                    message.success('已创建'); pricingRef.current?.reload(); return true;
                  } catch (e) { message.error((e as Error).message); return false; }
                }}>
                {/* 级联下拉（对齐现网：模型→其分辨率/时长），不手填 ID */}
                <ProFormSelect name="modelId" label="模型" rules={[{ required: true }]}
                  options={models.map((m) => ({ label: m.name, value: m.id }))} />
                <ProFormDependency name={['modelId']}>
                  {({ modelId }) => {
                    const sel = models.find((m) => m.id === modelId);
                    return (
                      <>
                        <ProFormSelect name="resolutionId" label="分辨率（可选）" allowClear
                          options={(sel?.resolutions ?? []).map((x) => ({ label: x.label, value: x.id }))} />
                        <ProFormSelect name="durationId" label="时长（可选）" allowClear
                          options={(sel?.durations ?? []).map((x) => ({ label: x.label, value: x.id }))} />
                      </>
                    );
                  }}
                </ProFormDependency>
                <ProFormDigit name="creditCost" label="积分消耗" rules={[{ required: true }, { validator: (_: unknown, v: number) => v >= 0 ? Promise.resolve() : Promise.reject(new Error('需非负')) }]} />
                <ProFormSwitch name="active" label="启用" initialValue={true} />
              </ModalForm>,
            ]}
          />
        </>
      )}
      {nodeTypes.length === 0 && <div className="py-16 text-center text-gray-400">暂未配置节点类型，请先执行种子数据</div>}
    </PageContainer>
  );
}

/** 模型新建/编辑弹窗（编辑回填、更新不发子资源、分辨率/时长按 nodeTypeKey 条件显示 —— 对齐 ModelFormModal.tsx:64/76） */
function ModelFormModal({ nodeTypeId, nodeTypeKey, record, onDone, trigger }: {
  nodeTypeId: string; nodeTypeKey?: string; record?: ModelData; onDone: () => void; trigger: ReactElement;
}) {
  const { message } = AntdApp.useApp();
  const isEdit = Boolean(record);
  const showResolutions = nodeTypeKey === 'image' || nodeTypeKey === 'video';
  const showDurations = nodeTypeKey === 'video';

  return (
    <ModalForm
      title={isEdit ? '编辑模型' : '新建模型'} trigger={trigger}
      modalProps={{ destroyOnClose: true }}
      initialValues={record ? {
        name: record.name, provider: record.provider, apiUrl: record.apiUrl,
        sortOrder: record.sortOrder, recommended: record.recommended, active: record.active,
        resolutions: record.resolutions.map((r) => ({ label: r.label, width: r.width, height: r.height })),
        durations: record.durations.map((d) => ({ label: d.label, seconds: d.seconds })),
      } : { sortOrder: 0, active: true }}
      onFinish={async (v: any) => {
        try {
          // base 必须剔除 resolutions/durations：后端 model.service.create 自建子资源，
          // data 带子资源+前端串行 add 是双重创建；编辑分支不发子资源（后端 update 只收标量）
          const { resolutions, durations, ...base } = v;
          if (isEdit && record) {
            await updateModel(record.id, base); // 编辑态子资源 List 已隐藏，resolutions/durations 恒 undefined
          } else {
            // 创建编排（spec §5.2）：createModel 后串行 addResolution/addDuration
            const created = await createModel(nodeTypeId, base);
            if (showResolutions) for (const r of resolutions ?? []) await addResolution(created.id, r);
            if (showDurations) for (const d of durations ?? []) await addDuration(created.id, d);
          }
          message.success(isEdit ? '已更新' : '已创建');
          onDone();
          return true;
        } catch (e) { message.error((e as Error).message); return false; }
      }}
    >
      <ProFormText name="name" label="名称" rules={[{ required: true }]} />
      <ProFormText name="provider" label="供应商" rules={[{ required: true }]} />
      <ProFormText name="apiUrl" label="API 地址" rules={[{ required: true }]} />
      {/* 编辑态不传 apiKey：保持服务端已存密钥不变（不回显明文）。安全债已登记（GET /admin/models 明文下发 apiKey）*/}
      {!isEdit && <ProFormText name="apiKey" label="API Key（可选）" placeholder="留空则沿用服务端配置" />}
      <ProFormDigit name="sortOrder" label="排序" initialValue={0} />
      <ProFormSwitch name="recommended" label="推荐" />{/* 无 active 开关：启停统一走行内「上线/下线」 */}
      {/* 编辑态隐藏子资源 List：更新分支不发子资源，仅创建时填写 */}
      {!isEdit && showResolutions && (
        <ProFormList name="resolutions" label="分辨率" initialValue={[]}
          creatorButtonProps={{ creatorButtonText: '添加分辨率' }}>
          <ProForm.Group>
            <ProFormText name="label" label="标签" rules={[{ required: true }]} />
            <ProFormDigit name="width" label="宽" rules={[{ required: true }]} />
            <ProFormDigit name="height" label="高" rules={[{ required: true }]} />
          </ProForm.Group>
        </ProFormList>
      )}
      {!isEdit && showDurations && (
        <ProFormList name="durations" label="时长" initialValue={[]}
          creatorButtonProps={{ creatorButtonText: '添加时长' }}>
          <ProForm.Group>
            <ProFormText name="label" label="标签" rules={[{ required: true }]} />
            <ProFormDigit name="seconds" label="秒" rules={[{ required: true }]} />
          </ProForm.Group>
        </ProFormList>
      )}
    </ModalForm>
  );
}
