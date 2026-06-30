import type { VideoTrimJobData } from './video-trim.types';

export interface FfmpegConfig {
  encoder: string;
  preset: string;
  crf: number;
}

export function buildFfmpegArgs(
  jobData: VideoTrimJobData,
  config: FfmpegConfig,
): string[] {
  const { inputPath, outputPath, startTime, endTime, hasAudio } = jobData;

  const duration = endTime - startTime;
  const preSeek = Math.max(0, startTime - 1);
  const postSeek = startTime - preSeek;

  const args: string[] = [
    '-ss', String(preSeek),
    '-i', inputPath,
    '-ss', String(postSeek),
    '-t', String(duration),
    '-c:v', config.encoder,
    '-preset', config.preset,
    '-crf', String(config.crf),
  ];

  if (hasAudio) {
    args.push('-c:a', 'aac');
  } else {
    args.push('-an');
  }

  args.push('-y', outputPath);
  return args;
}
