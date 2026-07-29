import { apiFetch } from './client';

export interface NodeTypeData {
  id: string; name: string; key: string; description?: string; active: boolean;
}

export interface ModelData {
  id: string; nodeTypeId: string; name: string; provider: string; apiUrl: string;
  sortOrder: number; recommended: boolean; active: boolean;
  resolutions: { id: string; label: string; width: number; height: number }[];
  durations: { id: string; label: string; seconds: number }[];
}

export interface PricingRuleData {
  id: string; nodeTypeId: string; modelId: string;
  resolutionId?: string; durationId?: string;
  creditCost: number; active: boolean;
  model?: { name: string };
  resolution?: { label: string };
  duration?: { label: string };
}

export async function fetchNodeTypes(): Promise<NodeTypeData[]> {
  return apiFetch('/admin/node-types');
}

export async function fetchModels(nodeTypeId: string): Promise<ModelData[]> {
  return apiFetch(`/admin/node-types/${nodeTypeId}/models`);
}

export async function createModel(nodeTypeId: string, data: any): Promise<ModelData> {
  return apiFetch(`/admin/node-types/${nodeTypeId}/models`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateModel(id: string, data: any): Promise<ModelData> {
  return apiFetch(`/admin/models/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function toggleModel(id: string): Promise<ModelData> {
  return apiFetch(`/admin/models/${id}/toggle`, { method: 'POST' });
}

export async function deleteModel(id: string): Promise<void> {
  return apiFetch(`/admin/models/${id}`, { method: 'DELETE' });
}

export async function addResolution(modelId: string, data: { label: string; width: number; height: number }) {
  return apiFetch(`/admin/models/${modelId}/resolutions`, { method: 'POST', body: JSON.stringify(data) });
}

export async function addDuration(modelId: string, data: { label: string; seconds: number }) {
  return apiFetch(`/admin/models/${modelId}/durations`, { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchPricingRules(nodeTypeId?: string, modelId?: string): Promise<PricingRuleData[]> {
  const params = new URLSearchParams();
  if (nodeTypeId) params.set('nodeTypeId', nodeTypeId);
  if (modelId) params.set('modelId', modelId);
  return apiFetch(`/admin/pricing-rules?${params}`);
}

export async function createPricingRule(data: any): Promise<PricingRuleData> {
  return apiFetch('/admin/pricing-rules', { method: 'POST', body: JSON.stringify(data) });
}

export async function deletePricingRule(id: string): Promise<void> {
  return apiFetch(`/admin/pricing-rules/${id}`, { method: 'DELETE' });
}

// ========== 参数配置 ==========

export interface SettingEntry {
  key: string;
  value: string;
}

export type SettingGroup = 'wechat_pay' | 'sms' | 'wechat_login';

/** 获取全部配置（按分组） */
export async function fetchAllSettings(): Promise<Record<SettingGroup, SettingEntry[]>> {
  return apiFetch('/admin/settings');
}

/** 获取指定分组的配置 */
export async function fetchSettingsByGroup(group: SettingGroup): Promise<SettingEntry[]> {
  return apiFetch(`/admin/settings/group?name=${group}`);
}

/** 批量保存配置 */
export async function saveSettings(entries: SettingEntry[]): Promise<void> {
  return apiFetch('/admin/settings', { method: 'PUT', body: JSON.stringify(entries) });
}
