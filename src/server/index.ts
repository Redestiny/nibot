import { serve, type ServerType } from '@hono/node-server';

import type { LlmClient } from '../core/types.js';
import { createServer } from './app.js';
import { createWebAppHandler } from './static.js';

export interface StartServerOptions {
  cwd: string;
  homeDir: string;
  /** Pass 0 to let the OS pick a free port; the resolved port is returned. */
  port: number;
  /** Directory holding the built web assets. Defaults to dist/web next to the compiled code. */
  webRoot?: string;
  llmClient?: LlmClient;
  now?: () => Date;
}

export async function startServer(options: StartServerOptions): Promise<{
  server: ServerType;
  url: string;
  port: number;
}> {
  const app = await createServer({
    cwd: options.cwd,
    homeDir: options.homeDir,
    llmClient: options.llmClient,
    now: options.now,
  });

  app.get('*', createWebAppHandler(options.webRoot));

  // Loopback only: the provider config behind this API holds plaintext keys.
  const hostname = '127.0.0.1';
  let server!: ServerType;
  const port = await new Promise<number>((resolvePort) => {
    server = serve({ fetch: app.fetch, port: options.port, hostname }, (info) => {
      resolvePort(info.port);
    });
  });

  return { server, port, url: `http://${hostname}:${port}` };
}
