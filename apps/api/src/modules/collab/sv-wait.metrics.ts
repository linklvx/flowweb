import { Counter, register } from 'prom-client';

export const svWaitTimeoutTotal = new Counter({
  name: 'yjs_sv_wait_timeout_total',
  help: 'readCanvas SV 等待超时降级次数',
  registers: [register],
});
