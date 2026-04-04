import { CHARACTERS_FILENAME, WORLD_STATE_FILENAME } from './constants.js';
import { OpenAiCompatibleLlmClient } from './llm.js';
import {
  buildCompleteMessages,
  buildSyncMessages,
  buildWriteMessages,
  formatChapterNumber,
} from './prompts.js';
import {
  addProviderToStore,
  loadProviderStore,
  maskApiKey,
  resolveProvider,
  saveProviderStore,
  setDefaultProviderInStore,
  validateProviderConfig,
} from './providers.js';
import { buildSyncDiff, parseSyncUpdate } from './sync.js';
import type {
  ChatMessage,
  CompleteChapterOptions,
  LlmClient,
  PrepareSyncOptions,
  ProviderConfig,
  SyncUpdate,
  WriteChapterOptions,
} from './types.js';
import {
  appendChapterFile,
  createBookWorkspace,
  getBookStatus,
  getContextPrevChapters,
  listBooks,
  loadChapter,
  loadRecentChapters,
  loadSettings,
  readBookMeta,
  readTrackedSetting,
  resolveBookPath,
  resolveCompleteTarget,
  resolveWriteTarget,
  writeChapterFile,
  writeTrackedSetting,
} from './workspace.js';
import { NibotError } from './errors.js';

export interface AppDependencies {
  cwd: string;
  homeDir: string;
  llmClient?: LlmClient;
  now?: () => Date;
}

export function createNibotApp(dependencies: AppDependencies) {
  const llmClient = dependencies.llmClient ?? new OpenAiCompatibleLlmClient();
  const now = dependencies.now ?? (() => new Date());

  return {
    async createBook(bookId: string) {
      return createBookWorkspace({
        rootDir: dependencies.cwd,
        bookId,
        now,
      });
    },

    async listBooks() {
      return listBooks(dependencies.cwd);
    },

    async getBookStatus(bookId: string) {
      return getBookStatus(dependencies.cwd, bookId);
    },

    async listProviders() {
      const store = await loadProviderStore(dependencies.homeDir);
      return {
        default_provider: store.default_provider ?? null,
        providers: store.providers.map((provider) => ({
          name: provider.name,
          base_url: provider.base_url,
          model: provider.model,
          api_key: maskApiKey(provider.api_key),
          is_default: store.default_provider === provider.name,
        })),
      };
    },

    async addProvider(providerInput: ProviderConfig) {
      const provider = validateProviderConfig(providerInput);
      const currentStore = await loadProviderStore(dependencies.homeDir);
      const nextStore = addProviderToStore(currentStore, provider);
      await saveProviderStore(nextStore, dependencies.homeDir);

      return {
        provider: {
          ...provider,
          api_key: maskApiKey(provider.api_key),
        },
        default_provider: nextStore.default_provider ?? null,
      };
    },

    async setDefaultProvider(providerName: string) {
      const currentStore = await loadProviderStore(dependencies.homeDir);
      const nextStore = setDefaultProviderInStore(currentStore, providerName);
      await saveProviderStore(nextStore, dependencies.homeDir);

      return {
        default_provider: providerName,
      };
    },

    async writeChapter(options: WriteChapterOptions) {
      const bookPath = await resolveBookPath(dependencies.cwd, options.bookId);
      const book = await readBookMeta(bookPath);
      const target = await resolveWriteTarget(bookPath, options.chapter);
      const settings = await loadSettings(bookPath);
      const previousChapters = await loadRecentChapters(
        bookPath,
        await getContextPrevChapters(bookPath),
      );
      const provider = await resolveProviderForApp(dependencies.homeDir, options.providerName);

      const messages = buildWriteMessages({
        chapterNumber: target.number,
        settings,
        previousChapters,
        intent: options.intent,
      });

      const content = await streamAndCollectText(llmClient, provider, messages, options.onText);
      ensureNonEmptyGeneratedText(content, 'chapter');
      await writeChapterFile(target.path, content);

      return {
        action: 'write',
        book_id: book.id,
        chapter: target.number,
        filename: target.filename,
        path: target.path,
        provider: provider.name,
        bytes: Buffer.byteLength(content),
      };
    },

    async completeChapter(options: CompleteChapterOptions) {
      const bookPath = await resolveBookPath(dependencies.cwd, options.bookId);
      const book = await readBookMeta(bookPath);
      const target = await resolveCompleteTarget(bookPath, options.chapter);
      const settings = await loadSettings(bookPath);
      const chapter = await loadChapter(bookPath, target.number);
      const provider = await resolveProviderForApp(dependencies.homeDir, options.providerName);

      const messages = buildCompleteMessages({
        chapterNumber: target.number,
        settings,
        chapter,
        intent: options.intent,
      });

      const content = await streamAndCollectText(llmClient, provider, messages, options.onText);
      ensureNonEmptyGeneratedText(content, 'chapter continuation');
      await appendChapterFile(target.path, content);

      return {
        action: 'complete',
        book_id: book.id,
        chapter: target.number,
        filename: target.filename,
        path: target.path,
        provider: provider.name,
        bytes: Buffer.byteLength(content),
      };
    },

    async prepareSync(options: PrepareSyncOptions): Promise<{
      book_id: string;
      chapter: number;
      provider: string;
      diff: string;
      changed_files: string[];
      update: SyncUpdate;
      summary?: string;
    }> {
      const bookPath = await resolveBookPath(dependencies.cwd, options.bookId);
      const book = await readBookMeta(bookPath);
      const latestChapterTarget = await resolveCompleteTarget(bookPath);
      const latestChapter = await loadChapter(bookPath, latestChapterTarget.number);
      const settings = await loadSettings(bookPath);
      const worldState = await readTrackedSetting(bookPath, WORLD_STATE_FILENAME);
      const characters = await readTrackedSetting(bookPath, CHARACTERS_FILENAME);
      const provider = await resolveProviderForApp(dependencies.homeDir, options.providerName);

      const rawResponse = await llmClient.generateText({
        provider,
        messages: buildSyncMessages({
          settings,
          latestChapter,
          worldState,
          characters,
        }),
      });

      const update = parseSyncUpdate(rawResponse);
      const diffResult = buildSyncDiff(
        {
          world_state: worldState,
          characters,
        },
        update,
      );

      return {
        book_id: book.id,
        chapter: latestChapter.number,
        provider: provider.name,
        diff: diffResult.diff,
        changed_files: diffResult.changed_files,
        update,
        summary: update.summary,
      };
    },

    async applySync(bookId: string, update: SyncUpdate) {
      const bookPath = await resolveBookPath(dependencies.cwd, bookId);
      await writeTrackedSetting(bookPath, WORLD_STATE_FILENAME, update.world_state);
      await writeTrackedSetting(bookPath, CHARACTERS_FILENAME, update.characters);

      return {
        book_id: bookId,
        updated_files: [`settings/${WORLD_STATE_FILENAME}`, `settings/${CHARACTERS_FILENAME}`],
      };
    },
  };
}

async function resolveProviderForApp(homeDir: string, providerName?: string): Promise<ProviderConfig> {
  const store = await loadProviderStore(homeDir);
  return resolveProvider(store, providerName);
}

async function streamAndCollectText(
  llmClient: LlmClient,
  provider: ProviderConfig,
  messages: ChatMessage[],
  onText?: (chunk: string) => void,
): Promise<string> {
  let content = '';

  for await (const chunk of llmClient.streamText({ provider, messages })) {
    content += chunk;
    onText?.(chunk);
  }

  return content;
}

function ensureNonEmptyGeneratedText(content: string, label: string): void {
  if (content.trim().length === 0) {
    throw new NibotError(`The model returned empty ${label} content.`, {
      code: 'EMPTY_LLM_RESPONSE',
    });
  }
}

export function renderBookCreatedMessage(result: Awaited<ReturnType<ReturnType<typeof createNibotApp>['createBook']>>): string {
  return `Created book "${result.book.id}" at ${result.path}.`;
}

export function renderBookListMessage(result: Awaited<ReturnType<ReturnType<typeof createNibotApp>['listBooks']>>): string {
  if (result.length === 0) {
    return 'No books found in the current directory.';
  }

  return result
    .map(
      (book) =>
        `${book.id} (${book.chapter_count} chapters${book.latest_chapter ? `, latest ${book.latest_chapter}` : ''})`,
    )
    .join('\n');
}

export function renderBookStatusMessage(result: Awaited<ReturnType<ReturnType<typeof createNibotApp>['getBookStatus']>>): string {
  return [
    `Book: ${result.id}`,
    `Title: ${result.title}`,
    `Language: ${result.lang}`,
    `Chapters: ${result.chapter_count}`,
    `Latest chapter: ${result.latest_chapter ?? 'none'}`,
    `Settings: ${result.settings_files.join(', ')}`,
  ].join('\n');
}

export function renderProviderListMessage(result: Awaited<ReturnType<ReturnType<typeof createNibotApp>['listProviders']>>): string {
  if (result.providers.length === 0) {
    return 'No providers configured.';
  }

  return result.providers
    .map((provider) => {
      const defaultTag = provider.is_default ? ' [default]' : '';
      return `${provider.name}${defaultTag} -> ${provider.model} @ ${provider.base_url} (${provider.api_key})`;
    })
    .join('\n');
}

export function renderWriteResultMessage(result: {
  action: string;
  book_id: string;
  chapter: number;
  filename: string;
  provider: string;
}): string {
  return `${result.action === 'write' ? 'Wrote' : 'Completed'} ${formatChapterNumber(result.chapter)} for "${result.book_id}" using provider "${result.provider}".`;
}
