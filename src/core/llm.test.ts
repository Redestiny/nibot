import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createResponseMock, clientConfigs } = vi.hoisted(() => ({
  createResponseMock: vi.fn(),
  clientConfigs: [] as Array<{ apiKey: string; baseURL: string }>,
}));

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    public readonly responses = {
      create: createResponseMock,
    };

    public constructor(config: { apiKey: string; baseURL: string }) {
      clientConfigs.push(config);
    }
  },
}));

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
    createResponseMock.mockReset();
    clientConfigs.splice(0, clientConfigs.length);
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

    createResponseMock.mockResolvedValue({
      output_text: '你好世界',
    });

    const client = new OpenAiCompatibleLlmClient();
    await expect(client.generateText({ provider, messages })).resolves.toBe('你好世界');

    expect(await readFile(configPath, 'utf8')).toContain('"api_key": "sk-test-123456"');
    expect(clientConfigs).toEqual([
      {
        apiKey: provider.api_key,
        baseURL: provider.base_url,
      },
    ]);
    expect(createResponseMock).toHaveBeenCalledWith({
      model: provider.model,
      instructions: '系统提示',
      input: [{ role: 'user', content: '继续写作' }],
    });
  });

  it('streams only non-empty text chunks', async () => {
    const { provider } = await createConfiguredProvider();

    createResponseMock.mockResolvedValue(
      toAsyncIterable([
        { type: 'response.created' },
        { type: 'response.output_text.delta', delta: '' },
        { type: 'response.output_text.delta', delta: '片段一' },
        { type: 'response.completed' },
        { type: 'response.output_text.delta', delta: '片段二' },
      ]),
    );

    const client = new OpenAiCompatibleLlmClient();
    await expect(collectStream(client.streamText({ provider, messages }))).resolves.toEqual([
      '片段一',
      '片段二',
    ]);

    expect(createResponseMock).toHaveBeenCalledWith({
      model: provider.model,
      instructions: '系统提示',
      input: [{ role: 'user', content: '继续写作' }],
      stream: true,
    });
  });

  it('rejects empty Responses API outputs', async () => {
    const { provider } = await createConfiguredProvider();

    createResponseMock.mockResolvedValue({
      output_text: '',
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

    createResponseMock.mockRejectedValue(new Error('upstream failed'));

    const client = new OpenAiCompatibleLlmClient();

    await expect(client.generateText({ provider, messages })).rejects.toMatchObject({
      name: 'NibotError',
      code: 'LLM_COMPLETION_FAILED',
      message: 'Completion failed via provider "deepseek".',
    });
  });
});

async function collectStream(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks;
}

async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
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
