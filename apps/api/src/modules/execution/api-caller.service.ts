import { Injectable } from '@nestjs/common';

export interface ImageGenParams {
  prompt: string;
  extraPrompt?: string;
  style?: string;
  model: string;
  resolution?: string;
  imageUrl?: string; // img2img source
}

export interface ImageGenResult {
  url: string;
  width: number;
  height: number;
}

@Injectable()
export class ApiCallerService {
  async callImageGen(params: ImageGenParams): Promise<ImageGenResult> {
    // Simulate API latency (1-2 seconds)
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));

    const [w, h] = (params.resolution || '1024×1024')
      .split('×').map(Number);

    const bgColor = Math.floor(Math.random() * 16777215).toString(16);
    const url = `/mock/generated_${bgColor}_${w}x${h}.jpg`;

    return { url, width: w || 1024, height: h || 1024 };
  }
}
