declare module 'soundtouchjs' {
  export class SoundTouch {
    constructor(); // 实测无参（dist L24）——pitch/tempo/rate 均为可写属性
    tempo: number; pitch: number; rate: number;
  }
  export class SimpleFilter {
    constructor(source: WebAudioBufferSource, pipe: SoundTouch);
    extract(target: Float32Array, numFrames: number): number;
  }
  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer);
  }
  export class PitchShifter { constructor(context: AudioContext, buffer: AudioBuffer, bufferSize: number); tempo: number; }
}
