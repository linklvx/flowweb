export const EDGE_PARTICLE_CONFIG = {
  count: 3,
  radius: 3,
  duration: 3000,
  stagger: 1000,          // duration / count
  directionOffset: 1500,  // duration / 2 (reserved for bidirectional)
  maxConnectedEdges: 20,  // reserved: future degradation threshold
} as const;
