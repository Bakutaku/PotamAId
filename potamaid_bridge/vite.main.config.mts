import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // node:sqlite は `node:` 付きでしか読み込めない組み込みモジュールで、
      // Vite の組み込みモジュールの一覧に含まれないことがあるため、明示的に外部扱いにする
      external: ['node:sqlite'],
    },
  },
});
