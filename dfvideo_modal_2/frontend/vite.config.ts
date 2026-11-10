import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const modalTarget = (env.MODAL_VIDEO_API_ORIGIN || 'https://goyeas52--dfvideo-web.us-east.modal.run').replace(/\/$/, '');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api/generate': {
          target: env.GEN_API_ORIGIN || 'http://127.0.0.1:8002',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/generate/, ''),
        },
        '/api/video': {
          target: modalTarget,
          changeOrigin: true,
          secure: true,
          timeout: 180000,
          proxyTimeout: 180000,
          rewrite: (path) => path.replace(/^\/api\/video/, ''),
        },
      },
    },
  };
});
