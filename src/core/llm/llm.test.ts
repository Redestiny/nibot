import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnthropicClient } from './anthropic.js';
import { OpenAiClient } from './openai.js';
import {
  getProviderConfigPath,
  loadProviderStore,
  resolveProvider,
  saveProviderStore,
} from '../providers.js';

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

describe('OpenAiClient', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        const { rm } = await import('node:fs/promises');
        await rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it('generates text via OpenAI SDK and saves provider config', async () => {
    const { provider, configPath } = await createConfiguredProvider();

    const mockResponse = { output_text: '你好世界' };

    const mockClient = {
      responses: {
        create: vi.fn().mockResolvedValue(mockResponse),
      },
    };

    const client = new OpenAiClient(provider, mockClient as any);
    const result = await client.generateText({ messages });

    expect(result).toBe('你好世界');
    expect(await readFile(configPath, 'utf8')).toContain('"api_key": "sk-test-123456"');
  });

  it('streams only non-empty text chunks', async () => {
    const { provider } = await createConfiguredProvider();

    const streamEvents = [
      { type: 'response.output_text.delta', delta: '' },
      { type: 'response.output_text.delta', delta: '片段一' },
      { type: 'response.output_text.delta', delta: '' },
      { type: 'response.output_text.delta', delta: '片段二' },
    ];

    // Create async generator instance
    async function* generateEvents() {
      for (const event of streamEvents) {
        yield event;
      }
    }
    const mockStream = generateEvents();

    const mockClient = {
      responses: {
        create: vi.fn().mockReturnValue(mockStream),
      },
    };

    const client = new OpenAiClient(provider, mockClient as any);
    const chunks: string[] = [];

    for await (const chunk of client.streamText({ messages })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['片段一', '片段二']);
  });

  it('rejects empty Responses API outputs', async () => {
    const { provider } = await createConfiguredProvider();

    const mockClient = {
      responses: {
        create: vi.fn().mockResolvedValue({ output_text: '' }),
      },
    };

    const client = new OpenAiClient(provider, mockClient as any);

    await expect(client.generateText({ messages })).rejects.toMatchObject({
      name: 'NibotError',
      code: 'EMPTY_LLM_RESPONSE',
      message: 'Model returned an empty response.',
    });
  });

  it('wraps completion failures in a NibotError', async () => {
    const { provider } = await createConfiguredProvider();

    const mockClient = {
      responses: {
        create: vi.fn().mockRejectedValue(new Error('API Error')),
      },
    };

    const client = new OpenAiClient(provider, mockClient as any);

    await expect(client.generateText({ messages })).rejects.toMatchObject({
      name: 'NibotError',
      code: 'LLM_COMPLETION_FAILED',
      message: 'Completion failed via provider "deepseek".',
    });
  });

  it('wraps stream connection failures in a NibotError', async () => {
    const { provider } = await createConfiguredProvider();

    const mockClient = {
      responses: {
        create: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
      },
    };

    const client = new OpenAiClient(provider, mockClient as any);

    await expect(collectStream(client.streamText({ messages }))).rejects.toMatchObject({
      name: 'NibotError',
      code: 'LLM_STREAM_FAILED',
      message: 'Streaming completion failed via provider "deepseek".',
    });
  });

  it('rejects responses truncated by max_output_tokens', async () => {
    const { provider } = await createConfiguredProvider();

    const mockClient = {
      responses: {
        create: vi.fn().mockResolvedValue({
          output_text: '被截断的内容',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      },
    };

    const client = new OpenAiClient(provider, mockClient as any);

    await expect(client.generateText({ messages })).rejects.toMatchObject({
      name: 'NibotError',
      code: 'LLM_RESPONSE_TRUNCATED',
    });
  });
});

describe('AnthropicClient', () => {
  const provider = {
    type: 'anthropic' as const,
    name: 'claude',
    base_url: 'https://proxy.example',
    api_key: 'sk-test-abcdef',
    model: 'claude-sonnet',
    max_tokens: 1024,
  };

  it('sends configured max_tokens and extracts text', async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '你好世界' }],
          stop_reason: 'end_turn',
        }),
      },
    };

    const client = new AnthropicClient(provider, mockClient as any);

    expect(await client.generateText({ messages })).toBe('你好世界');
    expect(mockClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 1024,
        system: [
          { type: 'text', text: '系统提示', cache_control: { type: 'ephemeral' } },
        ],
      }),
    );
  });

  it('rejects responses truncated by max_tokens', async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '被截断的内容' }],
          stop_reason: 'max_tokens',
        }),
      },
    };

    const client = new AnthropicClient(provider, mockClient as any);

    await expect(client.generateText({ messages })).rejects.toMatchObject({
      name: 'NibotError',
      code: 'LLM_RESPONSE_TRUNCATED',
    });
  });

  it('rejects streams truncated by max_tokens', async () => {
    async function* generateEvents() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '开头片段' } };
      yield { type: 'message_delta', delta: { stop_reason: 'max_tokens' } };
    }

    const mockClient = {
      messages: {
        stream: vi.fn().mockReturnValue(generateEvents()),
      },
    };

    const client = new AnthropicClient(provider, mockClient as any);

    await expect(collectStream(client.streamText({ messages }))).rejects.toMatchObject({
      name: 'NibotError',
      code: 'LLM_RESPONSE_TRUNCATED',
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
