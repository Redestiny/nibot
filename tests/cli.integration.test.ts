import { mkdtemp, readFile } from 'node:fs/promises';
import { PassThrough, Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import { saveProviderStore } from '../src/providers.js';
import type { LlmClient, LlmGenerateRequest, LlmStreamRequest } from '../src/types.js';

class FakeCliLlm implements LlmClient {
  public constructor(
    private readonly chunks: string[],
    private readonly syncResponse: string,
  ) {}

  public async *streamText(_request: LlmStreamRequest): AsyncIterable<string> {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }

  public async generateText(_request: LlmGenerateRequest): Promise<string> {
    return this.syncResponse;
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

describe('CLI integration', () => {
  it('creates books and lists them via json', async () => {
    const cwd = await createTempDir();
    const homeDir = await createTempDir();
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    expect(
      await runCli(['node', 'nibot', 'book', 'create', 'alpha', '--json'], {
        cwd,
        homeDir,
        stdout,
        stderr,
      }),
    ).toBe(0);

    const createPayload = await streamToString(stdout);
    expect(JSON.parse(createPayload)).toMatchObject({
      book: {
        id: 'alpha',
      },
    });

    const listStdout = new PassThrough();
    expect(
      await runCli(['node', 'nibot', 'book', 'list', '--json'], {
        cwd,
        homeDir,
        stdout: listStdout,
        stderr: new PassThrough(),
      }),
    ).toBe(0);

    expect(JSON.parse(await streamToString(listStdout))).toMatchObject({
      books: [{ id: 'alpha' }],
    });
  });

  it('streams write output to stderr in json mode and writes files', async () => {
    const cwd = await createTempDir();
    const homeDir = await createTempDir();
    const llm = new FakeCliLlm(['片段一', '片段二'], '{"world_state":"# World State\\n","characters":"# Characters\\n"}');

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

    await runCli(['node', 'nibot', 'book', 'create', 'alpha'], {
      cwd,
      homeDir,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    const stdout = new PassThrough();
    const stderr = new PassThrough();

    expect(
      await runCli(['node', 'nibot', 'write', 'alpha', '--json'], {
        cwd,
        homeDir,
        stdout,
        stderr,
        llmClient: llm,
      }),
    ).toBe(0);

    expect(await streamToString(stderr)).toContain('片段一片段二');
    expect(JSON.parse(await streamToString(stdout))).toMatchObject({
      action: 'write',
      chapter: 1,
      filename: '0001.md',
    });

    const chapterText = await readFile(join(cwd, 'alpha', 'chapters', '0001.md'), 'utf8');
    expect(chapterText).toBe('片段一片段二');
  });

  it('shows sync diff and only applies when confirmed', async () => {
    const cwd = await createTempDir();
    const homeDir = await createTempDir();
    const llm = new FakeCliLlm(
      ['写作文本'],
      JSON.stringify({
        world_state: '# World State\n\n新世界状态\n',
        characters: '# Characters\n\n新角色状态\n',
      }),
    );

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

    await runCli(['node', 'nibot', 'book', 'create', 'alpha'], {
      cwd,
      homeDir,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    await runCli(['node', 'nibot', 'write', 'alpha'], {
      cwd,
      homeDir,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      llmClient: llm,
    });

    const rejectStdout = new PassThrough();
    const rejectStderr = new PassThrough();
    await runCli(['node', 'nibot', 'sync', 'alpha', '--json'], {
      cwd,
      homeDir,
      stdout: rejectStdout,
      stderr: rejectStderr,
      stdin: Readable.from(['n\n']),
      llmClient: llm,
    });

    expect(JSON.parse(await streamToString(rejectStdout))).toMatchObject({
      applied: false,
      reason: 'rejected',
    });

    const applyStdout = new PassThrough();
    await runCli(['node', 'nibot', 'sync', 'alpha', '--json'], {
      cwd,
      homeDir,
      stdout: applyStdout,
      stderr: new PassThrough(),
      stdin: Readable.from(['y\n']),
      llmClient: llm,
    });

    expect(JSON.parse(await streamToString(applyStdout))).toMatchObject({
      applied: true,
      updated_files: ['settings/world_state.md', 'settings/characters.md'],
    });

    expect(
      await readFile(join(cwd, 'alpha', 'settings', 'world_state.md'), 'utf8'),
    ).toContain('新世界状态');
  });
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nibot-cli-'));
  tempDirs.push(dir);
  return dir;
}

function streamToString(stream: PassThrough): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = '';
    stream.on('data', (chunk) => {
      value += chunk.toString();
    });
    stream.on('end', () => resolve(value));
    stream.on('error', reject);
    stream.end();
  });
}
