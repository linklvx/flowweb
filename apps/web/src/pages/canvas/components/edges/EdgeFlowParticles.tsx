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
      {Array.from({ length: count }, (_, i) => {
        const beginTime = `${(isInward ? directionOffset : 0) + i * stagger}ms`;
        return (
          <circle
            key={i}
            r={radius}
            style={{ fill: 'var(--edge-flow-color)' }}
            visibility="hidden"
          >
            <set attributeName="visibility" to="visible" begin={beginTime} />
            <animateMotion
              path={pathD}
              dur={`${duration}ms`}
              begin={beginTime}
              repeatCount="indefinite"
              calcMode="linear"
              {...(isInward ? { keyPoints: '1;0', keyTimes: '0;1' } : {})}
            />
          </circle>
        );
      })}
    </>
  );
});
