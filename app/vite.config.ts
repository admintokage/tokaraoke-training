import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// GitHub Pages ではリポジトリ名のサブパスで配信されるため、相対パスでビルドする
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    // `npm run dev:lan`: 同じ Wi-Fi の iPhone から HTTPS で開けるよう自己署名証明書を使う
    ...(mode === 'lan' ? [basicSsl()] : []),
  ],
  worker: {
    // AudioWorklet は ES モジュールとして読み込む
    format: 'es',
  },
  server: {
    port: 5173,
  },
}));
