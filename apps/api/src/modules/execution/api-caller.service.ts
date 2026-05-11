import { Injectable } from '@nestjs/common';

export interface ImageGenParams {
  prompt: string;
  extraPrompt?: string;
  style?: string;
  model: string;
  resolution?: string;
  imageUrl?: string;
}

export interface ImageGenResult {
  url: string;
  width: number;
  height: number;
}

export interface TextGenParams {
  prompt: string;
  model: string;
  apiUrl: string;
}

export interface TextGenResult {
  content: string;
}

interface ModelConfig {
  apiUrl: string;
  apiKey: string;
  modelName: string;
  type: 'text' | 'image';
}

const MODEL_CONFIG: Record<string, ModelConfig> = {
  'seed-model-kimi': {
    apiUrl: 'https://api.moonshot.cn/v1',
    apiKey: 'sk-ODTW9ypl2G5G4xcFNR6IJCbr2ZRY07mPEZuNvySYzotpwlFD',
    modelName: 'kimi-k2.6',
    type: 'text',
  },
  'seed-model-hy-image': {
    apiUrl: 'https://tokenhub.tencentmaas.com/v1/api/image',
    apiKey: 'sk-3spY8oRUCrMphKWPwS8I8jKxTGH9LyCaDrxfhucZFpi02y2C',
    modelName: 'hy-image-v3.0',
    type: 'image',
  },
};

@Injectable()
export class ApiCallerService {

  /** Combine main prompt and extra prompt, ensuring at least one is present */
  combinePrompt(prompt: string, extraPrompt?: string): string {
    const parts = [prompt, extraPrompt].filter(Boolean);
    return parts.join(', ');
  }

  async callTextGen(params: TextGenParams): Promise<TextGenResult> {
    const config = MODEL_CONFIG[params.model];
    if (!config) {
      return { content: `[Mock response for: ${params.prompt.slice(0, 50)}...]` };
    }

    if (config.type === 'text') {
      const res = await fetch(`${config.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.modelName,
          messages: [
            { role: 'system', content: '你是一个AI助手，请根据用户提示词生成内容。' },
            { role: 'user', content: params.prompt },
          ],
          temperature: 1,
          max_tokens: 4096,
        }),
      });
      const json = await res.json() as any;
      return { content: json.choices?.[0]?.message?.content ?? '' };
    }

    return { content: `[Unknown model type]` };
  }

  async callImageGen(params: ImageGenParams): Promise<ImageGenResult> {
    const config = MODEL_CONFIG[params.model];

    // Real API: HY-Image async submit + poll
    if (config && config.type === 'image') {
      // Step 1: Submit
      const fullPrompt = this.combinePrompt(params.prompt, params.extraPrompt);
      const submitBody = JSON.stringify({ model: config.modelName, prompt: fullPrompt });
      console.log('[HY-Image] Submitting to:', `${config.apiUrl}/submit`, 'model:', config.modelName, 'prompt:', fullPrompt.slice(0, 80));
      const submitRes = await fetch(`${config.apiUrl}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
        body: submitBody,
      });
      const submitJson = await submitRes.json() as any;
      console.log('[HY-Image] Submit response:', JSON.stringify(submitJson).slice(0, 200));
      const taskId = submitJson.id || submitJson.task_id;
      if (!taskId) throw new Error(`Image submit failed: no task ID, got: ${JSON.stringify(submitJson).slice(0, 100)}`);

      // Step 2: Poll until complete (max 30 retries, 2s interval)
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const queryRes = await fetch(`${config.apiUrl}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
          body: JSON.stringify({ model: config.modelName, id: taskId }),
        });
        const queryJson = await queryRes.json() as any;

        if (queryJson.status === 'succeeded' || queryJson.status === 'completed' || queryJson.status === 'done') {
          const urls = queryJson.data || queryJson.results || queryJson.images || [];
          const first = Array.isArray(urls) ? urls[0] : urls;
          const resultUrl = typeof first === 'string' ? first : first?.url || first;
          const [w, h] = (params.resolution || '1024×1024').split('×').map(Number);
          return { url: String(resultUrl), width: w || 1024, height: h || 1024 };
        }
        if (queryJson.status === 'failed' || queryJson.status === 'error') {
          throw new Error(`Image generation failed: ${queryJson.error || 'unknown error'}`);
        }
      }
      throw new Error('Image generation timeout');
    }

    // Fallback: mock image
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
    const [w, h] = (params.resolution || '1024×1024').split('×').map(Number);
    const bgColor = Math.floor(Math.random() * 16777215).toString(16);
    const url = `/mock/generated_${bgColor}_${w}x${h}.jpg`;
    return { url, width: w || 1024, height: h || 1024 };
  }
}
