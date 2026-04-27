import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/v1': {
        target: 'http://localhost:1234',
        changeOrigin: true,
        ws: false,
      },
    },
  },
});
