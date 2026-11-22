import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const textTarget = (env.TEXT_API_ORIGIN || 'https://ykm20651--factrace-text-service-web.us-east.modal.run').replace(/\/$/, '');
  // const textTarget = (env.TEXT_API_ORIGIN || 'http://127.0.0.1:8001').replace(/\/$/, '');
  const modalTarget = (env.MODAL_VIDEO_API_ORIGIN || 'https://goyeas52--dfvideo-web.us-east.modal.run').replace(/\/$/, '');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api/text': {
          target: textTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/text/, '/api'),
        },
        '/api/video': {
          target: modalTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/video/, ''),
        },
      },
    },
  };
});
