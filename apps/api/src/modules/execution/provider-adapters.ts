// apps/api/src/modules/execution/provider-adapters.ts —— Y0b-2 T2（Z80/Z101/Z93/Z117①）
// ADAPTERS 注册表与 executable/ready 纯谓词定义在 @flowweb/shared（admin web 同源消费——见 shared 文件头）；
// 本文件挂 api 侧运行件：adapterFor 查表 + fakeAiEnabled 单源豁免 + seedEnv 字面量读。
import { ADAPTERS, type ProviderAdapter } from '@flowweb/shared';

export { ADAPTERS, executableModel as executable, readyModel as ready } from '@flowweb/shared';
export type { ProviderAdapter } from '@flowweb/shared';

export const adapterFor = (provider: string | null) => (provider ? ADAPTERS[provider] : undefined);

/** fakeAiEnabled 单源 helper——COLLAB_FAKE_AI 豁免表唯一读点（多读点会漂）。
 *  只被启动断言/CI 兜底/各 callXxx fake 分支消费——用户面谓词（executable）不含密钥维度故无需豁免。
 *  Z93：与 NODE_ENV 解耦（旧生产守卫删——fail-closed 主线是缺密钥拒启，fake 是显式豁免档）。 */
export const fakeAiEnabled = () => process.env.COLLAB_FAKE_AI === '1';

/** adapter 密钥字面量读（collab-env-single-source 方向①只认字面量——动态 process.env[key]
 *  扩前缀后会因正则收不到读点而假红）。启动断言与 DashScope 编辑链（kind 级配置留代码侧）共用。 */
export function seedEnvValue(key: ProviderAdapter['seedEnv']): string {
  switch (key) {
    case 'PROVIDER_MOONSHOT_API_KEY': return process.env.PROVIDER_MOONSHOT_API_KEY ?? '';
    case 'PROVIDER_TENCENT_API_KEY': return process.env.PROVIDER_TENCENT_API_KEY ?? '';
    case 'DASHSCOPE_API_KEY': return process.env.DASHSCOPE_API_KEY ?? '';
    default: return '';
  }
}
