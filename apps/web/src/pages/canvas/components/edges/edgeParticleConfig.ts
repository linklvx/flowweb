export const EDGE_PARTICLE_CONFIG = {
  count: 3,
  radius: 3,
  duration: 2000,
  stagger: 667,          // ~2000/3
  directionOffset: 1000,  // 2000/2
  maxConnectedEdges: 20, // reserved: future degradation threshold
} as const;
