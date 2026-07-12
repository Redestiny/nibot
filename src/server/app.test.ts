import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NibotError } from '../core/errors.js';
import { saveProviderStore } from '../core/providers.js';
import type { LlmClient, LlmGenerateRequest, LlmStreamRequest } from '../core/types.js';
import type { GenerateStreamEvent } from '../shared/bridge.js';
import { createServer } from './app.js';

class FakeLlmClient implements LlmClient {
  public constructor(
    public streamResponses: string[],
    private readonly generateResponse: string,
  ) {}

  public async *streamText(request: LlmStreamRequest): AsyncIterable<string> {
    for (const chunk of this.streamResponses) {
      if (request.signal?.aborted) {
        throw new NibotError('Generation aborted.', { code: 'ABORTED' });
      }
      yield chunk;
    }
  }

  public async generateText(_request: LlmGenerateRequest): Promise<string> {
    return this.generateResponse;
  }
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nibot-server-'));
  tempDirs.push(dir);
  return dir;
}

async function setupServer(llm?: LlmClient) {
  const cwd = await createTempDir();
  const homeDir = await createTempDir();
  const server = await createServer({ cwd, homeDir, llmClient: llm });

  await saveProviderStore(
    {
      providers: [
        {
          type: 'openai',
          name: 'deepseek',
          base_url: 'https://api.deepseek.com/v1',
          api_key: 'sk-test-123456',
          model: 'deepseek-chat',
        },
      ],
      default_provider: 'deepseek',
    },
    homeDir,
  );

  return { server, cwd, homeDir };
}

function jsonRequest(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

async function readNdjsonEvents(response: Response): Promise<GenerateStreamEvent[]> {
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as GenerateStreamEvent);
}

describe('nibot HTTP server', () => {
  it('creates and lists books', async () => {
    const { server } = await setupServer();

    const empty = await server.request('/api/books');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);

    const created = await server.request('/api/books', jsonRequest('POST', { book_id: 'story' }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id: 'story', chapter_count: 0 });

    const duplicate = await server.request('/api/books', jsonRequest('POST', { book_id: 'story' }));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: { code: 'BOOK_ALREADY_EXISTS' } });

    const missingStatus = await server.request('/api/books/nope/status');
    expect(missingStatus.status).toBe(404);
    expect(await missingStatus.json()).toMatchObject({ error: { code: 'BOOK_NOT_FOUND' } });
  });

  it('saves, lists, and reads chapters with sequence enforcement', async () => {
    const { server } = await setupServer();
    await server.request('/api/books', jsonRequest('POST', { book_id: 'story' }));

    const saved = await server.request(
      '/api/books/story/chapters/1',
      jsonRequest('PUT', { content: '第一章，含全角标点……——【】' }),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ chapter: 1, created: true });

    const gap = await server.request(
      '/api/books/story/chapters/3',
      jsonRequest('PUT', { content: '跳号' }),
    );
    expect(gap.status).toBe(400);
    expect(await gap.json()).toMatchObject({ error: { code: 'INVALID_CHAPTER_SEQUENCE' } });

    const list = await server.request('/api/books/story/chapters');
    expect(await list.json()).toEqual([{ number: 1, filename: '0001.md' }]);

    const chapter = await server.request('/api/books/story/chapters/1');
    expect(await chapter.json()).toMatchObject({
      number: 1,
      content: '第一章，含全角标点……——【】',
    });
  });

  it('reads and saves settings, rejecting unknown filenames', async () => {
    const { server, cwd } = await setupServer();
    await server.request('/api/books', jsonRequest('POST', { book_id: 'story' }));

    const settings = await server.request('/api/books/story/settings');
    const filenames = ((await settings.json()) as { filename: string }[]).map(
      (item) => item.filename,
    );
    expect(filenames).toEqual(['outline.md', 'characters.md', 'world_state.md']);

    const savedOutline = await server.request(
      '/api/books/story/settings/outline.md',
      jsonRequest('PUT', { content: '# 大纲\n\n主线更新。\n' }),
    );
    expect(savedOutline.status).toBe(200);
    expect(await readFile(join(cwd, 'story', 'settings', 'outline.md'), 'utf8')).toBe(
      '# 大纲\n\n主线更新。\n',
    );

    const rejected = await server.request(
      '/api/books/story/settings/evil.md',
      jsonRequest('PUT', { content: 'nope' }),
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: { code: 'INVALID_SETTING_FILENAME' } });
  });

  it('streams chapter generation as NDJSON text events followed by done', async () => {
    const llm = new FakeLlmClient(['第一段', '第二段'], '{}');
    const { server, cwd } = await setupServer(llm);
    await server.request('/api/books', jsonRequest('POST', { book_id: 'story' }));

    const response = await server.request(
      '/api/books/story/write',
      jsonRequest('POST', { intent: '开篇' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');

    const events = await readNdjsonEvents(response);
    expect(events).toEqual([
      { type: 'text', chunk: '第一段' },
      { type: 'text', chunk: '第二段' },
      {
        type: 'done',
        result: {
          action: 'write',
          book_id: 'story',
          chapter: 1,
          filename: '0001.md',
          provider: 'deepseek',
          bytes: Buffer.byteLength('第一段第二段'),
        },
      },
    ]);

    expect(await readFile(join(cwd, 'story', 'chapters', '0001.md'), 'utf8')).toBe(
      '第一段第二段',
    );
  });

  it('streams complete as a full-chapter replacement', async () => {
    const llm = new FakeLlmClient(['重写后的整章'], '{}');
    const { server, cwd } = await setupServer(llm);
    await server.request('/api/books', jsonRequest('POST', { book_id: 'story' }));
    await server.request('/api/books/story/chapters/1', jsonRequest('PUT', { content: '旧稿' }));

    const response = await server.request(
      '/api/books/story/complete',
      jsonRequest('POST', { chapter: 1 }),
    );
    const events = await readNdjsonEvents(response);
    expect(events.at(-1)).toMatchObject({ type: 'done', result: { action: 'complete' } });

    expect(await readFile(join(cwd, 'story', 'chapters', '0001.md'), 'utf8')).toBe(
      '重写后的整章',
    );
  });

  it('reports generation failures as a final NDJSON error event', async () => {
    const { server } = await setupServer(new FakeLlmClient([], '{}'));
    // Book does not exist: the failure happens before any text is streamed.
    const response = await server.request('/api/books/ghost/write', jsonRequest('POST', {}));
    expect(response.status).toBe(200);

    const events = await readNdjsonEvents(response);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'BOOK_NOT_FOUND' } });
  });

  it('prepares and applies sync updates', async () => {
    const llm = new FakeLlmClient(
      [],
      JSON.stringify({
        world_state: '# World State\n\n新事件。\n',
        characters: '# Characters\n\n新角色。\n',
        summary: '设定更新',
      }),
    );
    const { server, cwd } = await setupServer(llm);
    await server.request('/api/books', jsonRequest('POST', { book_id: 'story' }));
    await server.request('/api/books/story/chapters/1', jsonRequest('PUT', { content: '章节' }));

    const prepared = await server.request('/api/books/story/sync/prepare', jsonRequest('POST', {}));
    expect(prepared.status).toBe(200);
    const preview = (await prepared.json()) as {
      changed_files: string[];
      update: { world_state: string; characters: string };
    };
    expect(preview.changed_files).toEqual([
      'settings/world_state.md',
      'settings/characters.md',
    ]);

    const applied = await server.request(
      '/api/books/story/sync/apply',
      jsonRequest('POST', { update: preview.update }),
    );
    expect(applied.status).toBe(200);
    expect(await readFile(join(cwd, 'story', 'settings', 'world_state.md'), 'utf8')).toContain(
      '新事件',
    );
  });

  it('manages providers: add, set default, remove', async () => {
    const { server } = await setupServer();

    const added = await server.request(
      '/api/providers',
      jsonRequest('POST', {
        type: 'anthropic',
        name: 'claude',
        base_url: 'https://proxy.example',
        api_key: 'sk-test-abcdef',
        model: 'claude-sonnet',
      }),
    );
    expect(added.status).toBe(201);

    const setDefault = await server.request(
      '/api/providers/default',
      jsonRequest('PUT', { name: 'claude' }),
    );
    expect(await setDefault.json()).toMatchObject({ default_provider: 'claude' });

    const removed = await server.request('/api/providers/claude', { method: 'DELETE' });
    const afterRemove = (await removed.json()) as {
      default_provider: string | null;
      providers: { name: string; api_key: string }[];
    };
    expect(afterRemove.default_provider).toBeNull();
    expect(afterRemove.providers.map((provider) => provider.name)).toEqual(['deepseek']);
    // Keys never cross the bridge unmasked.
    expect(afterRemove.providers[0]!.api_key).not.toContain('sk-test-123456');

    const missing = await server.request('/api/providers/ghost', { method: 'DELETE' });
    expect(missing.status).toBe(404);
  });

  it('returns a JSON 404 for unknown API routes', async () => {
    const { server } = await setupServer();
    const response = await server.request('/api/unknown');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
