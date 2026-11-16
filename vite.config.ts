import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { douyinPreviewPlugin } from './plugins/douyinPreviewPlugin';

function githubPagesBase(): string {
    const raw = (process.env.GITHUB_PAGES_BASE ?? '/').trim() || '/';
    if (raw === '/') return '/';
    const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
    return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, '.', '');
    // API credentials are for local development only. Never embed them in a static build.
    const localApiKey = (name: string): string => command === 'serve' ? (env[name] ?? '') : '';
    return {
      base: githubPagesBase(),
      server: {
        port: 3000,
        host: '0.0.0.0',
        // 开发时 Seedream 请求经此转发，避免浏览器直连 ark 域名触发 CORS
        proxy: {
          // 浏览器直连 Kimi 常被 CORS 拦截，开发时走同源代理
          // 必须先写 cn：否则 /kimi-moonshot 会前缀匹配到 /kimi-moonshot-cn，路径被错写成 /-cn/... 导致 404
          '/kimi-moonshot-cn': {
            target: 'https://api.moonshot.cn',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/kimi-moonshot-cn/, ''),
          },
          '/kimi-moonshot': {
            target: 'https://api.moonshot.ai',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/kimi-moonshot/, ''),
          },
          '/volcengine-ark': {
            target: 'https://ark.cn-beijing.volces.com',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/volcengine-ark/, '/api/v3'),
          },
        },
      },
      plugins: [react(), douyinPreviewPlugin()],
      define: {
        'process.env.KIMI_API_KEY': JSON.stringify(localApiKey('KIMI_API_KEY')),
        'process.env.MOONSHOT_API_KEY': JSON.stringify(localApiKey('MOONSHOT_API_KEY')),
        'process.env.KIMI_MODEL': JSON.stringify(env.KIMI_MODEL ?? ''),
        'process.env.KIMI_API_BASE': JSON.stringify(env.KIMI_API_BASE ?? ''),
        'process.env.KIMI_MOONSHOT_HOST': JSON.stringify(env.KIMI_MOONSHOT_HOST ?? ''),
        'process.env.ARK_API_KEY': JSON.stringify(localApiKey('ARK_API_KEY')),
        'process.env.ARK_IMAGE_ENDPOINT': JSON.stringify(env.ARK_IMAGE_ENDPOINT ?? ''),
        'process.env.ARK_IMAGE_MODEL': JSON.stringify(env.ARK_IMAGE_MODEL ?? ''),
        'process.env.ARK_OUTFIT_MAX_REF_IMAGES': JSON.stringify(env.ARK_OUTFIT_MAX_REF_IMAGES ?? ''),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
