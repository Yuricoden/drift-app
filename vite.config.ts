import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

/**
 * In dev, the DRIFT API and the HTML route guards run inside the Vite dev
 * server, so `npm run dev` remains a single command on a single port.
 */
function driftServer(): Plugin {
  return {
    name: 'drift-server',
    async configureServer(server) {
      const { pageGuard, cleanUrls, createApi } = await import('./server/app');
      const { default: express } = await import('express');
      // A bare Router doesn't apply Express req/res prototypes; wrap it in an app.
      const apiApp = express();
      apiApp.use(createApi());
      // Vite's connect types differ from Express'; the middlewares are compatible at runtime.
      server.middlewares.use(pageGuard() as never);
      server.middlewares.use(cleanUrls() as never);
      server.middlewares.use('/api', apiApp as never);
    },
  };
}

export default defineConfig(({ mode }) => {
  // The server reads credentials/DB config from process.env; expose all env
  // vars (not just VITE_*) to it. None of these reach the client bundle.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    plugins: [preact(), driftServer()],
    server: { port: 5173 },
    build: {
      target: 'es2022',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          login: resolve(__dirname, 'login.html'),
          app: resolve(__dirname, 'app.html'),
        },
      },
    },
  };
});
