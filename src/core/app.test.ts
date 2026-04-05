import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNibotApp } from './app.js';
import { saveProviderStore } from './providers.js';
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
      yield chunk;
    }
  }

  public async generateText(request: LlmGenerateRequest): Promise<string> {
    this.generatedRequests.push(request);
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
    const app = createNibotApp({ cwd, homeDir, llmClient: llm });

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
    const llm = new FakeLlmClient(['续写内容'], '{"world_state":"# World State\\n","characters":"# Characters\\n"}');
    const app = createNibotApp({ cwd, homeDir, llmClient: llm });

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

    await app.completeChapter({ bookId: 'story' });
    await app.completeChapter({ bookId: 'story', chapter: 1 });
    await expect(app.completeChapter({ bookId: 'story', chapter: 9 })).rejects.toThrow(
      'Chapter 0009.md does not exist',
    );

    expect(await readFile(join(cwd, 'story', 'chapters', '0002.md'), 'utf8')).toBe(
      '第二章开头续写内容',
    );
    expect(await readFile(join(cwd, 'story', 'chapters', '0001.md'), 'utf8')).toBe(
      '原始开头续写内容',
    );
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
    const app = createNibotApp({ cwd, homeDir, llmClient: llm });

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
