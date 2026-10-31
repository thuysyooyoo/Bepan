import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Dev-only server middleware: gắn endpoint `POST /api/parse` ngay trên Vite Dev Server
 * để test trực tiếp Netlify Function (`netlify/functions/parse.mts`) với `GEMINI_API_KEY`
 * nằm an toàn phía Node process (tuyệt đối không lộ khóa ra bundle trình duyệt).
 */
function localGeminiApiDevPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'local-gemini-api-dev',
    configureServer(server) {
      if (env.GEMINI_API_KEY) {
        process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
      }
      if (env.GEMINI_MODEL) {
        process.env.GEMINI_MODEL = env.GEMINI_MODEL;
      }

      server.middlewares.use('/api/parse', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const mod = await server.ssrLoadModule('/netlify/functions/parse.mts');
          const webReq = new Request('http://localhost/api/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: rawBody,
          });
          const webRes: Response = await mod.default(webReq);
          res.statusCode = webRes.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'DEV_API_ERROR',
            })
          );
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: './',
    plugins: [react(), tailwindcss(), localGeminiApiDevPlugin(env)],
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/exceljs')) {
              return 'exceljs';
            }
            if (
              id.includes('node_modules/@supabase') ||
              id.includes('node_modules/dexie')
            ) {
              return 'data-engine';
            }
            if (
              id.includes('node_modules/react') ||
              id.includes('node_modules/lucide-react')
            ) {
              return 'ui-vendor';
            }
          },
        },
      },
    },
    server: {
      port: 5173,
      host: true,
    },
    test: {
      globals: true,
      environment: 'node',
      include: ['src/__tests__/**/*.test.ts'],
    },
  };
});
