import { useEffect, useRef, useCallback, type RefObject } from 'react';
import { LightingEngine, type ViewMode } from '../engine/LightingEngine';
import { type LightingParams } from '@flowweb/shared';

interface UseLightingEngineOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  thumbnailRef: RefObject<HTMLCanvasElement | null>;
  imageUrl: string | null;
  params: LightingParams;
  viewMode: ViewMode;
  onPositionChange: (pos: LightingParams['position']) => void;
}

interface UseLightingEngineReturn {
  reset: () => void;
}

export function useLightingEngine({
  containerRef,
  thumbnailRef,
  imageUrl,
  params,
  viewMode,
  onPositionChange,
}: UseLightingEngineOptions): UseLightingEngineReturn {
  const engineRef = useRef<LightingEngine | null>(null);
  const onPositionChangeRef = useRef(onPositionChange);
  onPositionChangeRef.current = onPositionChange;

  // Create / destroy engine
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !imageUrl) return;

    const engine = new LightingEngine(container, imageUrl, {
      thumbnailCanvas: thumbnailRef.current ?? undefined,
      onPositionChange: (pos) => onPositionChangeRef.current(pos),
    });
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [imageUrl]); // Only recreate if imageUrl changes

  // Sync params to engine
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setPosition(params.position.x, params.position.y, params.position.z);
  }, [params.position.x, params.position.y, params.position.z]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setBrightness(params.brightness);
  }, [params.brightness]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setColorTemperature(params.colorTemperature);
  }, [params.colorTemperature]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.toggleRimLight(params.rimLight);
  }, [params.rimLight]);

  // Sync view mode
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.switchViewMode(viewMode);
  }, [viewMode]);

  const reset = useCallback(() => {
    engineRef.current?.reset();
  }, []);

  return { reset };
}
