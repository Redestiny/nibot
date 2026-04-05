import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  chapterFilename,
  createBookWorkspace,
  getContextPrevChapters,
  loadSettings,
  parseChapterNumber,
  parseEnvFile,
  resolveCompleteTarget,
  resolveWriteTarget,
} from './workspace.js';

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await import('node:fs/promises').then(({ rm }) =>
        rm(dir, { recursive: true, force: true }),
      );
    }),
  );
});

describe('workspace helpers', () => {
  it('sorts settings with outline first', async () => {
    const rootDir = await createTempDir();
    await createBookWorkspace({ rootDir, bookId: 'novel' });
    const settingsPath = join(rootDir, 'novel', 'settings');
    await writeFile(join(settingsPath, 'timeline.md'), '# Timeline\n', 'utf8');
    await writeFile(join(settingsPath, 'abilities.md'), '# Abilities\n', 'utf8');

    const settings = await loadSettings(join(rootDir, 'novel'));
    expect(settings.map((setting) => setting.filename)).toEqual([
      'outline.md',
      'abilities.md',
      'characters.md',
      'timeline.md',
      'world_state.md',
    ]);
  });

  it('uses env override for previous chapter count and falls back on invalid values', async () => {
    const rootDir = await createTempDir();
    await createBookWorkspace({ rootDir, bookId: 'envbook' });
    const bookPath = join(rootDir, 'envbook');

    expect(await getContextPrevChapters(bookPath)).toBe(3);

    await writeFile(join(bookPath, '.env'), 'NIBOT_CONTEXT_PREV_CHAPTERS=5\n', 'utf8');
    expect(await getContextPrevChapters(bookPath)).toBe(5);

    await writeFile(join(bookPath, '.env'), 'NIBOT_CONTEXT_PREV_CHAPTERS=oops\n', 'utf8');
    expect(await getContextPrevChapters(bookPath)).toBe(3);
  });

  it('enforces contiguous write chapters and existing complete chapters', async () => {
    const rootDir = await createTempDir();
    await createBookWorkspace({ rootDir, bookId: 'chapters' });
    const bookPath = join(rootDir, 'chapters');
    const chaptersPath = join(bookPath, 'chapters');

    await writeFile(join(chaptersPath, '0001.md'), 'one', 'utf8');

    await expect(resolveWriteTarget(bookPath, 2)).resolves.toMatchObject({
      filename: '0002.md',
    });
    await expect(resolveWriteTarget(bookPath, 4)).rejects.toThrow(
      'The next available chapter is 0002.md',
    );
    await expect(resolveCompleteTarget(bookPath, 1)).resolves.toMatchObject({
      filename: '0001.md',
    });
    await expect(resolveCompleteTarget(bookPath, 9)).rejects.toThrow(
      'Chapter 0009.md does not exist',
    );
  });

  it('formats and parses chapter numbers as four digits', () => {
    expect(chapterFilename(12)).toBe('0012.md');
    expect(parseChapterNumber('12')).toBe(12);
    expect(() => parseChapterNumber('0')).toThrow('Chapter number must be an integer');
  });

  it('parses env files with comments and quotes', () => {
    expect(
      parseEnvFile(`
# comment
NIBOT_CONTEXT_PREV_CHAPTERS="7"
MODE='draft'
`),
    ).toEqual({
      NIBOT_CONTEXT_PREV_CHAPTERS: '7',
      MODE: 'draft',
    });
  });
});

async function createTempDir(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'nibot-workspace-'));
  createdDirs.push(dir);
  return dir;
}
