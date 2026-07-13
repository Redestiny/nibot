import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Context } from 'hono';

// Compiled location is dist/src/server/static.js, so ../../web is dist/web —
// the Vite build output that ships inside the published package. Electron
// bundles this module elsewhere and passes an explicit webRoot instead, so
// this stays lazy: bundlers may relocate import.meta.url.
function defaultWebDistDir(): string {
  return fileURLToPath(new URL('../../web/', import.meta.url));
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

// Serves the built web app with an SPA fallback to index.html. Registered as
// a catch-all GET route after the /api routes.
export function createWebAppHandler(
  webRoot?: string,
): (c: Context) => Promise<Response> {
  const rootDir = resolve(webRoot ?? defaultWebDistDir());

  return async function serveWebApp(c: Context): Promise<Response> {
    const requestPath = decodeURIComponent(new URL(c.req.url).pathname);
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/u, '');
    const filePath = resolve(rootDir, relativePath);

    if (filePath !== rootDir && !filePath.startsWith(rootDir + sep)) {
      return c.text('Forbidden', 403);
    }

    const file = await tryReadFile(filePath);
    if (file) {
      return respondWithFile(filePath, file);
    }

    const indexFile = await tryReadFile(resolve(rootDir, 'index.html'));
    if (indexFile) {
      return respondWithFile('index.html', indexFile);
    }

    return c.text(
      'Nibot GUI assets not found. Run "npm run build" to produce dist/web first.',
      404,
    );
  };
}

function respondWithFile(filePath: string, content: Buffer): Response {
  const mime = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  return new Response(new Uint8Array(content), { headers: { 'content-type': mime } });
}

async function tryReadFile(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}
