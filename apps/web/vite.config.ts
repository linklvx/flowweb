/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  // Worker 拆包：默认 'iife' 强制 inlineDynamicImports，会把 mediabunny/aac-polyfill 动态 import 内联进 worker 单文件
  worker: { format: 'es' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: true },
      '/collab': { target: 'ws://127.0.0.1:3001', ws: true },
      '/flowai': {
        target: 'http://127.0.0.1:9000',
        changeOrigin: true,
      },
    },
  },
  // 生产门禁（Playwright e2e）：vite preview 不读 server.proxy，四条代理逐字复制自上方 server.proxy
  // （含 /api 字符串简写形式）。server 段保持不动。
  preview: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: true },
      '/collab': { target: 'ws://127.0.0.1:3001', ws: true },
      '/flowai': {
        target: 'http://127.0.0.1:9000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // e2e/ 是 Playwright 用例——vitest 默认 include 含 **/*.spec.ts 会误吞（jsdom 跑不了浏览器用例）
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
