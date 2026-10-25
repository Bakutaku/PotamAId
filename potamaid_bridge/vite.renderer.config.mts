import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * パッケージ用のビルドにだけ Content-Security-Policy を付ける。
 * 開発時は Vite の HMR がインラインのスクリプトと WebSocket を使うため付けない。
 */
const contentSecurityPolicy = (): Plugin => ({
  name: 'potamaid-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:" />`,
    ),
});

// https://vitejs.dev/config
export default defineConfig({
  // Tailwind CSS v4 は Vite のプラグインとして読み込む（daisyUI は index.css の @plugin で有効化）
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
});
