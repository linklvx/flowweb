// packages/shared/src/constants/provider-adapters.ts —— Y0b-2 T2（Z80/Z101/Z117①）
// provider adapter 注册表 + executable/ready 双谓词单源。双端消费：
// ① api（modules/execution/provider-adapters.ts 再导出并挂 adapterFor/seedEnvValue/fakeAiEnabled）；
// ② admin web（ModelsPage adapter 下拉 Object.keys(ADAPTERS) + 列表 ready 标记）。
// 放 shared 的原因：apps/web 无 alias 直读 apps/api src（vite/tsconfig 仅 @flowweb/shared）——
// 注册表落 shared 保单一派生点（web 侧手抄 slug 表=漂移源）。
// E51 补全：AIModel 是唯一模型源（provider=slug+apiModelName+apiUrl+行级 apiKey）；
// 本表只做"provider→外呼方式"映射。DashScope 编辑链=显式例外（定价 kind 级 modelId NULL——
// 不建 AIModel 行，配置留代码侧——kind 级密钥只从 seedEnv 读，非"运行期只读 AIModel.apiKey"的全局真理；
// 模型化归 Z57 重构统一）。

export interface ProviderAdapter {
  type: 'openai-chat' | 'tencent-submit-poll' | 'dashscope-submit-poll';
  seedEnv: 'PROVIDER_MOONSHOT_API_KEY' | 'PROVIDER_TENCENT_API_KEY' | 'DASHSCOPE_API_KEY';
}

export const ADAPTERS: Record<string, ProviderAdapter> = {
  moonshot: { type: 'openai-chat', seedEnv: 'PROVIDER_MOONSHOT_API_KEY' },
  tencent: { type: 'tencent-submit-poll', seedEnv: 'PROVIDER_TENCENT_API_KEY' },
  dashscope: { type: 'dashscope-submit-poll', seedEnv: 'DASHSCOPE_API_KEY' }, // 编辑四 kind 例外
};

/** Z101 两谓词拆分——executable=目录属性（可售性）：models 端点/validation 预检 MODEL_NOT_AVAILABLE/
 *  admin 标记/选择器消费。CI 零密钥（无 seed 步+INSERT 显式 NULL）下 executable 仍可选——
 *  funds-four-way 夹具零密钥可跑；运行中进程缺密钥结构性不可达（Z93 拒启兜底）⇒用户面 401 不存在
 *  ——禁用 4xx 掩盖运维故障。 */
export const executableModel = (m: { active: boolean; provider: string; apiModelName: string | null }) =>
  m.active && !!ADAPTERS[m.provider] && !!m.apiModelName;

/** ready=运维就绪（executable ∧ 行级密钥在位）——只进启动断言（与 adapter seedEnv 并列为断言输入）
 *  +admin 写边界（Z117①）/列表标记（面向运维看密钥）。 */
export const readyModel = (m: { active: boolean; provider: string; apiModelName: string | null; apiKey: string | null }) =>
  executableModel(m) && !!m.apiKey;
