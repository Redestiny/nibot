import { serve, type ServerType } from '@hono/node-server';

import type { LlmClient } from '../core/types.js';
import { createServer } from './app.js';
import { serveWebApp } from './static.js';

export interface StartServerOptions {
  cwd: string;
  homeDir: string;
  port: number;
  llmClient?: LlmClient;
  now?: () => Date;
}

export async function startServer(options: StartServerOptions): Promise<{
  server: ServerType;
  url: string;
}> {
  const app = await createServer({
    cwd: options.cwd,
    homeDir: options.homeDir,
    llmClient: options.llmClient,
    now: options.now,
  });

  app.get('*', serveWebApp);

  // Loopback only: the provider config behind this API holds plaintext keys.
  const hostname = '127.0.0.1';
  const server = serve({ fetch: app.fetch, port: options.port, hostname });

  return { server, url: `http://${hostname}:${options.port}` };
}
