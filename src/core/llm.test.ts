import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.stubGlobal('fetch', fetchMock);

import { OpenAiCompatibleLlmClient } from './llm.js';
import {
  getProviderConfigPath,
  loadProviderStore,
  resolveProvider,
  saveProviderStore,
} from './providers.js';

const providerStore = {
  providers: [
    {
      type: 'openai' as const,
      name: 'deepseek',
      base_url: 'https://api.deepseek.com/v1',
      api_key: 'sk-test-123456',
      model: 'deepseek-chat',
    },
  ],
  default_provider: 'deepseek',
};

const messages = [
  { role: 'system' as const, content: '系统提示' },
  { role: 'user' as const, content: '继续写作' },
];

const tempDirs: string[] = [];

describe('OpenAiCompatibleLlmClient', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        const { rm } = await import('node:fs/promises');
        await rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it('generates text and forwards Responses API request fields', async () => {
    const { provider, configPath } = await createConfiguredProvider();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ output_text: '你好世界' }),
      text: async () => '{"output_text": "你好世界"}',
    });

    const client = new OpenAiCompatibleLlmClient();
    await expect(client.generateText({ provider, messages })).resolves.toBe('你好世界');

    expect(await readFile(configPath, 'utf8')).toContain('"api_key": "sk-test-123456"');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': 'Bearer sk-test-123456',
          'Content-Type': 'application/json',
        },
      }),
    );

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callBody).toEqual({
      model: 'deepseek-chat',
      instructions: '系统提示',
      input: [{ role: 'user', content: '继续写作' }],
    });
  });

  it('streams only non-empty text chunks', async () => {
    const { provider } = await createConfiguredProvider();

    const streamEvents = [
      'event: response.created\ndata: {"type":"response.created"}\n\n',
      'data: {"type":"response.output_text.delta","delta":""}\n\n',
      'data: {"type":"response.output_text.delta","delta":"片段一"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"片段二"}\n\n',
    ];

    fetchMock.mockResolvedValue(createStreamingResponse(streamEvents));

    const client = new OpenAiCompatibleLlmClient();
    await expect(collectStream(client.streamText({ provider, messages }))).resolves.toEqual([
      '片段一',
      '片段二',
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callBody).toEqual({
      model: 'deepseek-chat',
      instructions: '系统提示',
      input: [{ role: 'user', content: '继续写作' }],
      stream: true,
    });
  });

  it('rejects empty Responses API outputs', async () => {
    const { provider } = await createConfiguredProvider();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ output_text: '' }),
      text: async () => '{"output_text": ""}',
    });

    const client = new OpenAiCompatibleLlmClient();

    await expect(client.generateText({ provider, messages })).rejects.toMatchObject({
      name: 'NibotError',
      code: 'EMPTY_LLM_RESPONSE',
      message: 'Model returned an empty response.',
    });
  });

  it('wraps completion failures in a NibotError', async () => {
    const { provider } = await createConfiguredProvider();

    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const client = new OpenAiCompatibleLlmClient();

    await expect(client.generateText({ provider, messages })).rejects.toMatchObject({
      name: 'NibotError',
      code: 'LLM_COMPLETION_FAILED',
      message: 'Completion failed via provider "deepseek".',
    });
  });
});

function createStreamingResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    body: stream,
  } as Response;
}

async function collectStream(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks;
}

async function createConfiguredProvider(): Promise<{
  provider: Awaited<ReturnType<typeof resolveProvider>>;
  configPath: string;
}> {
  const homeDir = await createTempDir();
  await saveProviderStore(providerStore, homeDir);

  const store = await loadProviderStore(homeDir);

  return {
    provider: resolveProvider(store),
    configPath: getProviderConfigPath(homeDir),
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nibot-llm-'));
  tempDirs.push(dir);
  return dir;
}
