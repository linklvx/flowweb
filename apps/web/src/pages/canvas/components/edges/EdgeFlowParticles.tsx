import { memo } from 'react';
import { EDGE_PARTICLE_CONFIG } from './edgeParticleConfig';

interface EdgeFlowParticlesProps {
  pathD: string;
  direction: 'outward' | 'inward';
}

export const EdgeFlowParticles = memo(function EdgeFlowParticles({
  pathD,
  direction,
}: EdgeFlowParticlesProps) {
  const { count, radius, duration, stagger, directionOffset } = EDGE_PARTICLE_CONFIG;
  const isInward = direction === 'inward';

  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <circle
          key={i}
          r={radius}
          style={{ fill: 'var(--edge-flow-color)' }}
        >
          <animateMotion
            path={pathD}
            dur={`${duration}ms`}
            begin={`${(isInward ? directionOffset : 0) + i * stagger}ms`}
            repeatCount="indefinite"
            calcMode="linear"
            {...(isInward ? { keyPoints: '1;0', keyTimes: '0;1' } : {})}
          />
        </circle>
      ))}
    </>
  );
});
