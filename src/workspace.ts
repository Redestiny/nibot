import {
  access,
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  BOOK_ENV_FILENAME,
  BOOK_META_FILENAME,
  CHAPTERS_DIRNAME,
  CHARACTERS_FILENAME,
  DEFAULT_CONTEXT_PREV_CHAPTERS,
  MAX_CHAPTER_NUMBER,
  OUTLINE_FILENAME,
  SETTINGS_DIRNAME,
  WORLD_STATE_FILENAME,
} from './constants.js';
import { NibotError } from './errors.js';
import type { BookMeta, LoadedChapter, LoadedSetting } from './types.js';

interface CreateBookOptions {
  rootDir: string;
  bookId: string;
  now?: () => Date;
}

export interface BookSummary {
  id: string;
  title: string;
  lang: string;
  created_at: string;
  path: string;
  chapter_count: number;
  latest_chapter: string | null;
}

export interface BookStatus extends BookSummary {
  settings_files: string[];
}

export interface WriteTarget {
  number: number;
  filename: string;
  path: string;
}

export async function createBookWorkspace(options: CreateBookOptions): Promise<{
  book: BookMeta;
  path: string;
}> {
  const { rootDir, bookId } = options;
  validateBookId(bookId);
  const now = options.now ?? (() => new Date());
  const bookPath = join(rootDir, bookId);

  try {
    await stat(bookPath);
    throw new NibotError(`Book "${bookId}" already exists at ${bookPath}.`, {
      code: 'BOOK_ALREADY_EXISTS',
    });
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  await mkdir(join(bookPath, SETTINGS_DIRNAME), { recursive: true });
  await mkdir(join(bookPath, CHAPTERS_DIRNAME), { recursive: true });

  const book: BookMeta = {
    id: bookId,
    title: bookId,
    created_at: now().toISOString(),
    lang: 'zh',
  };

  await writeFile(join(bookPath, BOOK_META_FILENAME), `${JSON.stringify(book, null, 2)}\n`, 'utf8');
  await writeFile(join(bookPath, BOOK_ENV_FILENAME), 'NIBOT_CONTEXT_PREV_CHAPTERS=3\n', 'utf8');
  await writeFile(join(bookPath, SETTINGS_DIRNAME, OUTLINE_FILENAME), '# Outline\n\n', 'utf8');
  await writeFile(
    join(bookPath, SETTINGS_DIRNAME, WORLD_STATE_FILENAME),
    '# World State\n\n',
    'utf8',
  );
  await writeFile(
    join(bookPath, SETTINGS_DIRNAME, CHARACTERS_FILENAME),
    '# Characters\n\n',
    'utf8',
  );

  return { book, path: bookPath };
}

export async function listBooks(rootDir: string): Promise<BookSummary[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const summaries: BookSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const bookPath = join(rootDir, entry.name);

    try {
      const meta = await readBookMeta(bookPath);
      const chapters = await getChapterFiles(bookPath);
      const latestChapter = chapters.at(-1) ?? null;
      summaries.push({
        id: meta.id,
        title: meta.title,
        lang: meta.lang,
        created_at: meta.created_at,
        path: bookPath,
        chapter_count: chapters.length,
        latest_chapter: latestChapter,
      });
    } catch {
      continue;
    }
  }

  summaries.sort((left, right) => left.id.localeCompare(right.id));
  return summaries;
}

export async function getBookStatus(rootDir: string, bookId: string): Promise<BookStatus> {
  const bookPath = await resolveBookPath(rootDir, bookId);
  const meta = await readBookMeta(bookPath);
  const chapters = await getChapterFiles(bookPath);
  const settings = await listSettingFilenames(bookPath);

  return {
    id: meta.id,
    title: meta.title,
    lang: meta.lang,
    created_at: meta.created_at,
    path: bookPath,
    chapter_count: chapters.length,
    latest_chapter: chapters.at(-1) ?? null,
    settings_files: settings,
  };
}

export async function resolveBookPath(rootDir: string, bookId: string): Promise<string> {
  validateBookId(bookId);
  const bookPath = join(rootDir, bookId);

  await ensureBookWorkspace(bookPath);
  return bookPath;
}

export async function readBookMeta(bookPath: string): Promise<BookMeta> {
  const bookMetaPath = join(bookPath, BOOK_META_FILENAME);

  let raw: string;
  try {
    raw = await readFile(bookMetaPath, 'utf8');
  } catch (error) {
    throw new NibotError(`Missing ${BOOK_META_FILENAME} in ${bookPath}.`, {
      code: 'INVALID_BOOK_WORKSPACE',
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new NibotError(`Book metadata at ${bookMetaPath} is not valid JSON.`, {
      code: 'INVALID_BOOK_METADATA',
      cause: error,
    });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new NibotError(`Book metadata at ${bookMetaPath} must be a JSON object.`, {
      code: 'INVALID_BOOK_METADATA',
    });
  }

  const candidate = parsed as Record<string, unknown>;

  return {
    id: readNonEmptyString(candidate.id, 'Book id'),
    title: readNonEmptyString(candidate.title, 'Book title'),
    created_at: readNonEmptyString(candidate.created_at, 'Book created_at'),
    lang: readNonEmptyString(candidate.lang, 'Book lang'),
  };
}

export async function loadSettings(bookPath: string): Promise<LoadedSetting[]> {
  const settingsPath = join(bookPath, SETTINGS_DIRNAME);
  const filenames = await listSettingFilenames(bookPath);

  if (!filenames.includes(OUTLINE_FILENAME)) {
    throw new NibotError(`Missing ${OUTLINE_FILENAME} in ${settingsPath}.`, {
      code: 'INVALID_BOOK_WORKSPACE',
    });
  }

  return Promise.all(
    filenames.map(async (filename) => ({
      filename,
      content: await readFile(join(settingsPath, filename), 'utf8'),
    })),
  );
}

export async function getContextPrevChapters(bookPath: string): Promise<number> {
  const env = await readBookEnv(bookPath);
  const rawValue = env.NIBOT_CONTEXT_PREV_CHAPTERS;

  if (!rawValue) {
    return DEFAULT_CONTEXT_PREV_CHAPTERS;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_CONTEXT_PREV_CHAPTERS;
  }

  return parsed;
}

export async function getChapterFiles(bookPath: string): Promise<string[]> {
  const chaptersPath = join(bookPath, CHAPTERS_DIRNAME);

  try {
    const filenames = await readdir(chaptersPath);
    return filenames
      .filter((filename) => /^\d{4}\.md$/.test(filename))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    throw new NibotError(`Missing ${CHAPTERS_DIRNAME} directory in ${bookPath}.`, {
      code: 'INVALID_BOOK_WORKSPACE',
      cause: error,
    });
  }
}

export async function loadRecentChapters(
  bookPath: string,
  count: number,
): Promise<LoadedChapter[]> {
  const chapterFiles = await getChapterFiles(bookPath);
  const targetFiles = chapterFiles.slice(-count);
  return Promise.all(targetFiles.map((filename) => readChapterByFilename(bookPath, filename)));
}

export async function loadChapter(
  bookPath: string,
  chapterNumber: number,
): Promise<LoadedChapter> {
  return readChapterByFilename(bookPath, chapterFilename(chapterNumber));
}

export async function resolveWriteTarget(
  bookPath: string,
  requestedChapter?: number,
): Promise<WriteTarget> {
  const chapterFiles = await getChapterFiles(bookPath);
  const latestChapter = chapterFiles.at(-1);
  const latestNumber = latestChapter ? parseChapterFilename(latestChapter) : 0;
  const expected = latestNumber + 1;

  if (requestedChapter === undefined) {
    return buildWriteTarget(bookPath, expected);
  }

  const requestedFilename = chapterFilename(requestedChapter);
  if (chapterFiles.includes(requestedFilename)) {
    throw new NibotError(
      `Chapter ${requestedFilename} already exists. Use "nibot complete" instead.`,
      { code: 'CHAPTER_ALREADY_EXISTS' },
    );
  }

  if (requestedChapter !== expected) {
    throw new NibotError(
      `Chapter ${requestedFilename} cannot be created. The next available chapter is ${chapterFilename(expected)}.`,
      { code: 'INVALID_CHAPTER_SEQUENCE' },
    );
  }

  return buildWriteTarget(bookPath, requestedChapter);
}

export async function resolveCompleteTarget(
  bookPath: string,
  requestedChapter?: number,
): Promise<WriteTarget> {
  const chapterFiles = await getChapterFiles(bookPath);

  if (chapterFiles.length === 0) {
    throw new NibotError('No chapters exist yet. Use "nibot write" to create the first chapter.', {
      code: 'NO_CHAPTERS',
    });
  }

  if (requestedChapter === undefined) {
    const latestFilename = chapterFiles.at(-1);
    if (!latestFilename) {
      throw new NibotError('No chapters exist yet.', { code: 'NO_CHAPTERS' });
    }

    return buildWriteTarget(bookPath, parseChapterFilename(latestFilename));
  }

  const filename = chapterFilename(requestedChapter);

  if (!chapterFiles.includes(filename)) {
    throw new NibotError(`Chapter ${filename} does not exist.`, {
      code: 'CHAPTER_NOT_FOUND',
    });
  }

  return buildWriteTarget(bookPath, requestedChapter);
}

export async function writeChapterFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8');
}

export async function appendChapterFile(path: string, content: string): Promise<void> {
  await appendFile(path, content, 'utf8');
}

export async function readTrackedSetting(
  bookPath: string,
  filename: typeof WORLD_STATE_FILENAME | typeof CHARACTERS_FILENAME,
): Promise<string> {
  const filePath = join(bookPath, SETTINGS_DIRNAME, filename);
  return readFile(filePath, 'utf8');
}

export async function writeTrackedSetting(
  bookPath: string,
  filename: typeof WORLD_STATE_FILENAME | typeof CHARACTERS_FILENAME,
  content: string,
): Promise<void> {
  const filePath = join(bookPath, SETTINGS_DIRNAME, filename);
  await writeFile(filePath, content, 'utf8');
}

export function chapterFilename(chapterNumber: number): string {
  validateChapterNumber(chapterNumber);
  return `${String(chapterNumber).padStart(4, '0')}.md`;
}

export function parseChapterNumber(input: string): number {
  const value = Number.parseInt(input, 10);
  validateChapterNumber(value);
  return value;
}

export function validateChapterNumber(value: number): void {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_CHAPTER_NUMBER) {
    throw new NibotError(
      `Chapter number must be an integer between 1 and ${MAX_CHAPTER_NUMBER}.`,
      { code: 'INVALID_CHAPTER_NUMBER' },
    );
  }
}

export function parseEnvFile(raw: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key.length > 0) {
      result[key] = value;
    }
  }

  return result;
}

export function validateBookId(bookId: string): void {
  if (!bookId || bookId.trim().length === 0) {
    throw new NibotError('Book id must be a non-empty string.', { code: 'INVALID_BOOK_ID' });
  }

  if (bookId !== basename(bookId) || bookId === '.' || bookId === '..') {
    throw new NibotError(
      'Book id must be a single path segment and cannot contain path separators.',
      { code: 'INVALID_BOOK_ID' },
    );
  }
}

async function ensureBookWorkspace(bookPath: string): Promise<void> {
  try {
    await access(join(bookPath, BOOK_META_FILENAME));
    await access(join(bookPath, SETTINGS_DIRNAME));
    await access(join(bookPath, CHAPTERS_DIRNAME));
  } catch (error) {
    throw new NibotError(`Book workspace does not exist or is incomplete at ${bookPath}.`, {
      code: 'BOOK_NOT_FOUND',
      cause: error,
    });
  }
}

async function listSettingFilenames(bookPath: string): Promise<string[]> {
  const settingsPath = join(bookPath, SETTINGS_DIRNAME);
  let filenames: string[];

  try {
    filenames = await readdir(settingsPath);
  } catch (error) {
    throw new NibotError(`Missing ${SETTINGS_DIRNAME} directory in ${bookPath}.`, {
      code: 'INVALID_BOOK_WORKSPACE',
      cause: error,
    });
  }

  return filenames
    .filter((filename) => filename.endsWith('.md'))
    .sort((left, right) => {
      if (left === OUTLINE_FILENAME) {
        return -1;
      }

      if (right === OUTLINE_FILENAME) {
        return 1;
      }

      return left.localeCompare(right);
    });
}

async function readBookEnv(bookPath: string): Promise<Record<string, string>> {
  const envPath = join(bookPath, BOOK_ENV_FILENAME);

  try {
    return parseEnvFile(await readFile(envPath, 'utf8'));
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }

    throw new NibotError(`Failed to read ${BOOK_ENV_FILENAME} in ${bookPath}.`, {
      code: 'BOOK_ENV_READ_ERROR',
      cause: error,
    });
  }
}

async function readChapterByFilename(bookPath: string, filename: string): Promise<LoadedChapter> {
  const fullPath = join(bookPath, CHAPTERS_DIRNAME, filename);
  const content = await readFile(fullPath, 'utf8');
  return {
    number: parseChapterFilename(filename),
    filename,
    path: fullPath,
    content,
  };
}

function parseChapterFilename(filename: string): number {
  return Number.parseInt(filename.replace(/\.md$/u, ''), 10);
}

function buildWriteTarget(bookPath: string, chapterNumber: number): WriteTarget {
  const filename = chapterFilename(chapterNumber);
  return {
    number: chapterNumber,
    filename,
    path: join(bookPath, CHAPTERS_DIRNAME, filename),
  };
}

function readNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new NibotError(`${fieldName} must be a non-empty string.`, {
      code: 'INVALID_BOOK_METADATA',
    });
  }

  return value.trim();
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
