import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createCompletionMock, clientConfigs } = vi.hoisted(() => ({
  createCompletionMock: vi.fn(),
  clientConfigs: [] as Array<{ apiKey: string; baseURL: string }>,
}));

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    public readonly chat = {
      completions: {
        create: createCompletionMock,
      },
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
    createCompletionMock.mockReset();
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

  it('generates text and forwards OpenAI-compatible request fields', async () => {
    const { provider, configPath } = await createConfiguredProvider();

    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: [{ text: '你好' }, { text: '世界' }],
          },
        },
      ],
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
    expect(createCompletionMock).toHaveBeenCalledWith({
      model: provider.model,
      messages,
    });
  });

  it('streams only non-empty text chunks', async () => {
    const { provider } = await createConfiguredProvider();

    createCompletionMock.mockResolvedValue(
      toAsyncIterable([
        { choices: [{ delta: { content: '' } }] },
        { choices: [{ delta: { content: '片段一' } }] },
        { choices: [{ delta: { content: [{ text: '片段' }, { text: '二' }] } }] },
        { choices: [{ delta: { content: null } }] },
      ]),
    );

    const client = new OpenAiCompatibleLlmClient();
    await expect(collectStream(client.streamText({ provider, messages }))).resolves.toEqual([
      '片段一',
      '片段二',
    ]);

    expect(createCompletionMock).toHaveBeenCalledWith({
      model: provider.model,
      messages,
      stream: true,
    });
  });

  it('wraps completion failures in a NibotError', async () => {
    const { provider } = await createConfiguredProvider();

    createCompletionMock.mockRejectedValue(new Error('upstream failed'));

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
