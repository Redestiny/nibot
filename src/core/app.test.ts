import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNibotApp } from './app.js';
import { NibotError } from './errors.js';
import { loadProviderStore, saveProviderStore } from './providers.js';
import type { LlmClient, LlmGenerateRequest, LlmStreamRequest } from './types.js';

class FakeLlmClient implements LlmClient {
  public readonly streamedRequests: LlmStreamRequest[] = [];
  public readonly generatedRequests: LlmGenerateRequest[] = [];

  public constructor(
    public readonly streamResponses: string[],
    private readonly generateResponse: string,
  ) {}

  public async *streamText(request: LlmStreamRequest): AsyncIterable<string> {
    this.streamedRequests.push(request);
    for (const chunk of this.streamResponses) {
      // Mirror the real clients: an aborted signal surfaces as NibotError ABORTED.
      if (request.signal?.aborted) {
        throw new NibotError('Generation aborted.', { code: 'ABORTED' });
      }
      yield chunk;
    }
    if (request.signal?.aborted) {
      throw new NibotError('Generation aborted.', { code: 'ABORTED' });
    }
  }

  public async generateText(request: LlmGenerateRequest): Promise<string> {
    this.generatedRequests.push(request);
    if (request.signal?.aborted) {
      throw new NibotError('Generation aborted.', { code: 'ABORTED' });
    }
    return this.generateResponse;
  }
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      const { rm } = await import('node:fs/promises');
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('Nibot app integration', () => {
  it('creates a book workspace and writes sequential chapters', async () => {
    const cwd = await createTempDir();
    const homeDir = await createTempDir();
    const llm = new FakeLlmClient(['第一段', '第二段'], '{"world_state":"# World State\\n","characters":"# Characters\\n"}');
    const app = await createNibotApp({ cwd, homeDir, llmClient: llm });

    await saveProviderStore(
      {
        providers: [
          {
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

    await app.createBook('story');
    const first = await app.writeChapter({ bookId: 'story' });
    expect(first.filename).toBe('0001.md');

    llm.streamResponses.splice(0, llm.streamResponses.length, '第三章');
    const second = await app.writeChapter({ bookId: 'story', chapter: 2 });
    expect(second.filename).toBe('0002.md');

    await expect(app.writeChapter({ bookId: 'story', chapter: 4 })).rejects.toThrow(
      'The next available chapter is 0003.md',
    );

    const content1 = await readFile(join(cwd, 'story', 'chapters', '0001.md'), 'utf8');
    const content2 = await readFile(join(cwd, 'story', 'chapters', '0002.md'), 'utf8');

    expect(content1).toBe('第一段第二段');
    expect(content2).toBe('第三章');
  });

  it('completes the latest or requested chapter and rejects missing targets', async () => {
    const cwd = await createTempDir();
    const homeDir = await createTempDir();
    const llm = new FakeLlmClient(['完整章节'], '{"world_state":"# World State\\n","characters":"# Characters\\n"}');
    const app = await createNibotApp({ cwd, homeDir, llmClient: llm });

    await saveProviderStore(
      {
        providers: [
          {
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

    await app.createBook('story');
    await writeFile(join(cwd, 'story', 'chapters', '0001.md'), '原始开头', 'utf8');
    await writeFile(join(cwd, 'story', 'chapters', '0002.md'), '第二章开头', 'utf8');

    expect(await readFile(join(cwd, 'story', 'chapters', '0001.md'), 'utf8')).toBe('原始开头');
    expect(await readFile(join(cwd, 'story', 'chapters', '0002.md'), 'utf8')).toBe('第二章开头');

    await app.completeChapter({ bookId: 'story' });
    await app.completeChapter({ bookId: 'story', chapter: 1 });
    await expect(app.completeChapter({ bookId: 'story', chapter: 9 })).rejects.toThrow(
      'Chapter 0009.md does not exist',
    );

    expect(await readFile(join(cwd, 'story', 'chapters', '0002.md'), 'utf8')).toBe(
      '完整章节',
    );
    expect(await readFile(join(cwd, 'story', 'chapters', '0001.md'), 'utf8')).toBe(
      '完整章节',
    );
  });

  it('resolves the requested provider override and rejects unknown providers', async () => {
    const cwd = await createTempDir();
    const homeDir = await createTempDir();
    const llm = new FakeLlmClient(['章节内容'], '{}');
    const app = await createNibotApp({ cwd, homeDir, llmClient: llm });

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
          {
            type: 'anthropic',
            name: 'claude',
            base_url: 'https://proxy.example',
            api_key: 'sk-test-abcdef',
            model: 'claude-sonnet',
          },
        ],
        default_provider: 'deepseek',
      },
      homeDir,
    );

    await app.createBook('story');

    const result = await app.writeChapter({ bookId: 'story', providerName: 'claude' });
    expect(result.provider).toBe('claude');

    await expect(
      app.writeChapter({ bookId: 'story', providerName: 'missing' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' });
  });

  it('aborts a streaming generation without writing the chapter file', async () => {
    const cwd = await createTempDir();
    const homeDir = await createTempDir();
    const llm = new FakeLlmClient(['第一段', '第二段', '第三段'], '{}');
    const app = await createNibotApp({ cwd, homeDir, llmClient: llm });

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

    await app.createBook('story');

    const controller = new AbortController();
    const received: string[] = [];

    await expect(
      app.writeChapter({
        bookId: 'story',
        signal: controller.signal,
        onText: (chunk) => {
          received.push(chunk);
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: 'ABORTED' });

    expect(received).toEqual(['第一段']);
    expect(await app.listChapters('story')).toEqual([]);
  });

  it('lists, reads, and saves chapters with sequence enforcement', async () => {
    const cwd = await createTempDir();
    const homeDir = await createTempDir();
    const app = await createNibotApp({ cwd, homeDir, llmClient: new FakeLlmClient([], '{}') });

    await app.createBook('story');
    expect(await app.listChapters('story')).toEqual([]);

    const created = await app.saveChapter({ bookId: 'story', chapter: 1, content: '第一章草稿' });
    expect(created).toMatchObject({ chapter: 1, filename: '0001.md', created: true });

    const overwritten = await app.saveChapter({ bookId: 'story', chapter: 1, content: '第一章重写' });
    expect(overwritten).toMatchObject({ chapter: 1, created: false });
    expect((await app.getChapter('story', 1)).content).toBe('第一章重写');

    await expect(
      app.saveChapter({ bookId: 'story', chapter: 3, content: '跳号章节' }),
    ).rejects.toMatchObject({ code: 'INVALID_CHAPTER_SEQUENCE' });

    await app.saveChapter({ bookId: 'story', chapter: 2, content: '' });
    expect(await app.listChapters('story')).toEqual([
      { number: 1, filename: '0001.md' },
      { number: 2, filename: '0002.md' },
    ]);
  });

  it('reads and saves settings including outline.md', async () => {
    const cwd = await createTempDir();
    const homeDir = await createTempDir();
    const app = await createNibotApp({ cwd, homeDir, llmClient: new FakeLlmClient([], '{}') });

    await app.createBook('story');

    const settings = await app.getSettings('story');
    expect(settings.map((setting) => setting.filename)).toEqual([
      'outline.md',
      'characters.md',
      'world_state.md',
    ]);

    await app.saveSetting({ bookId: 'story', filename: 'outline.md', content: '# 大纲\n\n新的主线。\n' });
    expect(await readFile(join(cwd, 'story', 'settings', 'outline.md'), 'utf8')).toBe(
      '# 大纲\n\n新的主线。\n',
    );
  });

  it('removes providers and clears the default when it is removed', async () => {
    const cwd = await createTempDir();
    const homeDir = await createTempDir();
    const app = await createNibotApp({ cwd, homeDir, llmClient: new FakeLlmClient([], '{}') });

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
          {
            type: 'anthropic',
            name: 'claude',
            base_url: 'https://proxy.example',
            api_key: 'sk-test-abcdef',
            model: 'claude-sonnet',
          },
        ],
        default_provider: 'deepseek',
      },
      homeDir,
    );

    const result = await app.removeProvider('deepseek');
    expect(result).toEqual({ removed: 'deepseek', default_provider: null });

    const store = await loadProviderStore(homeDir);
    expect(store.providers.map((provider) => provider.name)).toEqual(['claude']);
    expect(store.default_provider).toBeUndefined();

    await expect(app.removeProvider('missing')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_FOUND',
    });
  });

  it('prepares and applies sync updates after diff review', async () => {
    const cwd = await createTempDir();
    const homeDir = await createTempDir();
    const llm = new FakeLlmClient(
      ['不会用到'],
      JSON.stringify({
        world_state: '# World State\n\n世界已经改变。\n',
        characters: '# Characters\n\n主角获得新伤痕。\n',
        summary: '更新了世界状态和角色状态',
      }),
    );
    const app = await createNibotApp({ cwd, homeDir, llmClient: llm });

    await saveProviderStore(
      {
        providers: [
          {
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

    await app.createBook('story');
    await writeFile(join(cwd, 'story', 'chapters', '0001.md'), '最新章节内容', 'utf8');

    const prepared = await app.prepareSync({ bookId: 'story' });
    expect(prepared.changed_files).toEqual([
      'settings/world_state.md',
      'settings/characters.md',
    ]);
    expect(prepared.diff).toContain('settings/world_state.md');

    const beforeWorldState = await readFile(
      join(cwd, 'story', 'settings', 'world_state.md'),
      'utf8',
    );
    expect(beforeWorldState).toBe('# World State\n\n');

    await app.applySync('story', prepared.update);

    const afterWorldState = await readFile(
      join(cwd, 'story', 'settings', 'world_state.md'),
      'utf8',
    );
    const afterCharacters = await readFile(
      join(cwd, 'story', 'settings', 'characters.md'),
      'utf8',
    );

    expect(afterWorldState).toContain('世界已经改变');
    expect(afterCharacters).toContain('主角获得新伤痕');
  });
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nibot-app-'));
  tempDirs.push(dir);
  return dir;
}
