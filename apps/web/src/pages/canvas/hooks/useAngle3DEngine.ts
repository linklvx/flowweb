import { useEffect, useRef, useCallback, type RefObject } from 'react';
import { Angle3DEngine } from '../engine/Angle3DEngine';
import { type Angle3DParams, type Angle3DPresetKey } from '@flowweb/shared';

interface UseAngle3DEngineOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  imageUrl: string | null;
  params: Angle3DParams;
  onParamsChange: (params: Partial<Angle3DParams>) => void;
}

interface UseAngle3DEngineReturn {
  reset: () => void;
}

export function useAngle3DEngine({
  containerRef,
  imageUrl,
  params,
  onParamsChange,
}: UseAngle3DEngineOptions): UseAngle3DEngineReturn {
  const engineRef = useRef<Angle3DEngine | null>(null);
  const onParamsChangeRef = useRef(onParamsChange);
  onParamsChangeRef.current = onParamsChange;

  // Create / destroy engine
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !imageUrl) return;

    const engine = new Angle3DEngine(container, imageUrl, {
      onParamsChange: (p) => onParamsChangeRef.current(p),
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
    engine.setHorizontalAngle(params.horizontalAngle);
  }, [params.horizontalAngle]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setVerticalAngle(params.verticalAngle);
  }, [params.verticalAngle]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setZoom(params.zoom);
  }, [params.zoom]);

  const reset = useCallback(() => {
    engineRef.current?.reset();
  }, []);

  return { reset };
}
