import { Hono } from 'hono';

import { createNibotApp, type AppDependencies } from '../core/app.js';
import { NibotError } from '../core/errors.js';
import { isSettingFilename, parseChapterNumber } from '../core/workspace.js';
import type { GenerateResult, GenerateStreamEvent } from '../shared/bridge.js';
import { toBridgeError } from './errors.js';

type NibotApp = Awaited<ReturnType<typeof createNibotApp>>;

// Same DI seam as the CLI: tests inject cwd/homeDir/llmClient, `nibot gui`
// passes the real ones. The renderer never talks to core directly — every
// route below implements one NibotBridge method over HTTP.
export async function createServer(dependencies: AppDependencies): Promise<Hono> {
  const app = await createNibotApp(dependencies);
  const server = new Hono();

  server.onError((error, c) => {
    const { status, error: bridgeError } = toBridgeError(error);
    return c.json({ error: bridgeError }, status);
  });

  server.notFound((c) => {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `No route for ${c.req.method} ${c.req.path}.` } },
      404,
    );
  });

  server.get('/api/books', async (c) => {
    return c.json(await app.listBooks());
  });

  server.post('/api/books', async (c) => {
    const body = await readJsonBody(c.req.raw);
    const bookId = readRequiredString(body, 'book_id');
    await app.createBook(bookId);
    return c.json(await app.getBookStatus(bookId), 201);
  });

  server.get('/api/books/:id/status', async (c) => {
    return c.json(await app.getBookStatus(c.req.param('id')));
  });

  server.get('/api/books/:id/chapters', async (c) => {
    return c.json(await app.listChapters(c.req.param('id')));
  });

  server.get('/api/books/:id/chapters/:num', async (c) => {
    const chapter = await app.getChapter(c.req.param('id'), parseChapterNumber(c.req.param('num')));
    return c.json({
      number: chapter.number,
      filename: chapter.filename,
      content: chapter.content,
    });
  });

  server.put('/api/books/:id/chapters/:num', async (c) => {
    const body = await readJsonBody(c.req.raw);
    const content = readRequiredString(body, 'content', { allowEmpty: true });
    const result = await app.saveChapter({
      bookId: c.req.param('id'),
      chapter: parseChapterNumber(c.req.param('num')),
      content,
    });
    return c.json(result);
  });

  server.get('/api/books/:id/settings', async (c) => {
    return c.json(await app.getSettings(c.req.param('id')));
  });

  server.put('/api/books/:id/settings/:filename', async (c) => {
    const filename = c.req.param('filename');
    if (!isSettingFilename(filename)) {
      throw new NibotError(
        `Setting "${filename}" is not editable. Expected outline.md, world_state.md, or characters.md.`,
        { code: 'INVALID_SETTING_FILENAME' },
      );
    }

    const body = await readJsonBody(c.req.raw);
    const content = readRequiredString(body, 'content', { allowEmpty: true });
    const result = await app.saveSetting({ bookId: c.req.param('id'), filename, content });
    return c.json(result);
  });

  server.post('/api/books/:id/write', (c) => {
    return streamGeneration(c.req.raw, app, c.req.param('id'), 'write');
  });

  server.post('/api/books/:id/complete', (c) => {
    return streamGeneration(c.req.raw, app, c.req.param('id'), 'complete');
  });

  server.post('/api/books/:id/sync/prepare', async (c) => {
    const body = await readJsonBody(c.req.raw);
    const provider = readOptionalString(body, 'provider');
    const prepared = await app.prepareSync({
      bookId: c.req.param('id'),
      providerName: provider,
      signal: c.req.raw.signal,
    });
    return c.json(prepared);
  });

  server.post('/api/books/:id/sync/apply', async (c) => {
    const body = await readJsonBody(c.req.raw);
    const update = body.update;
    if (!update || typeof update !== 'object') {
      throw new NibotError('Request body must contain an "update" object.', {
        code: 'INVALID_REQUEST_BODY',
      });
    }

    const candidate = update as Record<string, unknown>;
    const applied = await app.applySync(c.req.param('id'), {
      world_state: readRequiredString(candidate, 'world_state', { allowEmpty: true }),
      characters: readRequiredString(candidate, 'characters', { allowEmpty: true }),
    });
    return c.json(applied);
  });

  server.get('/api/providers', async (c) => {
    return c.json(await app.listProviders());
  });

  server.post('/api/providers', async (c) => {
    const body = await readJsonBody(c.req.raw);
    // validateProviderConfig in core performs the real field validation.
    await app.addProvider(body as never);
    return c.json(await app.listProviders(), 201);
  });

  server.put('/api/providers/default', async (c) => {
    const body = await readJsonBody(c.req.raw);
    await app.setDefaultProvider(readRequiredString(body, 'name'));
    return c.json(await app.listProviders());
  });

  server.delete('/api/providers/:name', async (c) => {
    await app.removeProvider(c.req.param('name'));
    return c.json(await app.listProviders());
  });

  return server;
}

// Generation streams NDJSON over a chunked 200 response. Failures after the
// stream starts cannot change the HTTP status, so errors travel as a final
// {type:'error'} event; the client bridge turns them back into exceptions.
function streamGeneration(
  request: Request,
  app: NibotApp,
  bookId: string,
  kind: 'write' | 'complete',
): Response {
  const headers = new Headers({ 'content-type': 'application/x-ndjson; charset=utf-8' });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: GenerateStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const payload = await readJsonBody(request);
        const options = {
          bookId,
          chapter: readOptionalChapter(payload),
          intent: readOptionalString(payload, 'intent'),
          providerName: readOptionalString(payload, 'provider'),
          // Aborting the fetch on the client fires this signal, which core
          // forwards into the underlying SDK request.
          signal: request.signal,
          onText: (chunk: string) => send({ type: 'text', chunk }),
        };

        const result =
          kind === 'write' ? await app.writeChapter(options) : await app.completeChapter(options);

        const done: GenerateResult = {
          action: result.action,
          book_id: result.book_id,
          chapter: result.chapter,
          filename: result.filename,
          provider: result.provider,
          bytes: result.bytes,
        };
        send({ type: 'done', result: done });
      } catch (error) {
        try {
          send({ type: 'error', error: toBridgeError(error).error });
        } catch {
          // The client is gone (aborted fetch); nothing left to notify.
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by cancellation.
        }
      }
    },
  });

  return new Response(body, { headers });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    const text = await request.text();
    parsed = text.trim().length === 0 ? {} : JSON.parse(text);
  } catch (error) {
    throw new NibotError('Request body must be valid JSON.', {
      code: 'INVALID_REQUEST_BODY',
      cause: error,
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NibotError('Request body must be a JSON object.', {
      code: 'INVALID_REQUEST_BODY',
    });
  }

  return parsed as Record<string, unknown>;
}

function readRequiredString(
  body: Record<string, unknown>,
  field: string,
  options?: { allowEmpty?: boolean },
): string {
  const value = body[field];
  if (typeof value !== 'string' || (!options?.allowEmpty && value.trim().length === 0)) {
    throw new NibotError(`Request body field "${field}" must be a non-empty string.`, {
      code: 'INVALID_REQUEST_BODY',
    });
  }
  return value;
}

function readOptionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new NibotError(`Request body field "${field}" must be a string.`, {
      code: 'INVALID_REQUEST_BODY',
    });
  }
  return value;
}

function readOptionalChapter(body: Record<string, unknown>): number | undefined {
  const value = body.chapter;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new NibotError('Request body field "chapter" must be an integer.', {
      code: 'INVALID_REQUEST_BODY',
    });
  }
  return value;
}
