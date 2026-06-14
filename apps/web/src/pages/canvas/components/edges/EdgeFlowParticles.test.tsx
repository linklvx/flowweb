import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EdgeFlowParticles } from './EdgeFlowParticles';

describe('EdgeFlowParticles', () => {
  const pathD = 'M 0 0 C 50 0, 50 100, 100 100';

  it('should render correct number of circles for outward direction', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="outward" />
      </svg>,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(3);
    expect(container.querySelectorAll('animateMotion')).toHaveLength(3);
  });

  it('should render correct number of circles for inward direction', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="inward" />
      </svg>,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(3);
    expect(container.querySelectorAll('animateMotion')).toHaveLength(3);
  });

  it('outward particles should NOT have keyPoints attribute', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="outward" />
      </svg>,
    );
    const motions = container.querySelectorAll('animateMotion');
    motions.forEach((m) => {
      expect(m.getAttribute('keyPoints')).toBeNull();
    });
  });

  it('inward particles SHOULD have keyPoints="1;0" and keyTimes="0;1"', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="inward" />
      </svg>,
    );
    const motions = container.querySelectorAll('animateMotion');
    motions.forEach((m) => {
      expect(m.getAttribute('keyPoints')).toBe('1;0');
      expect(m.getAttribute('keyTimes')).toBe('0;1');
      expect(m.getAttribute('calcMode')).toBe('linear');
    });
  });

  it('should use CSS variable for fill color', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="outward" />
      </svg>,
    );
    const circle = container.querySelector('circle')!;
    expect(circle.getAttribute('style')).toContain('var(--edge-flow-color)');
  });

  it('should stagger particle begin times', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="outward" />
      </svg>,
    );
    const begins = Array.from(container.querySelectorAll('animateMotion')).map(
      (m) => m.getAttribute('begin'),
    );
    expect(begins).toEqual(['0ms', '667ms', '1334ms']);
  });
});
