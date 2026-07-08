import { CHARACTERS_FILENAME, WORLD_STATE_FILENAME } from './constants.js';
import { LLMClient } from './llm/llm_wrapper.js';
import { buildCompleteMessages, buildSyncMessages, buildWriteMessages } from './prompts.js';
import {
  addProviderToStore,
  loadProviderStore,
  maskApiKey,
  resolveProvider,
  saveProviderStore,
  setDefaultProviderInStore,
  validateProviderConfig,
} from './providers.js';
import { buildSyncDiff, ensureTrailingNewline, parseSyncUpdate } from './sync.js';
import type {
  ChatMessage,
  CompleteChapterOptions,
  LlmClient,
  LoadedSetting,
  PrepareSyncOptions,
  ProviderConfig,
  SyncUpdate,
  WriteChapterOptions,
} from './types.js';
import {
  createBookWorkspace,
  getBookStatus,
  getContextPrevChapters,
  listBooks,
  loadChapter,
  loadRecentChapters,
  loadSettings,
  readBookMeta,
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

export async function createNibotApp(dependencies: AppDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const clientCache = new Map<string, LlmClient>();

  // When a test injects a client, always use it (no per-provider caching).
  // Otherwise, lazy-create and cache LLM clients per provider name so that
  // --provider overrides actually switch to a different client.
  const resolveProviderAndClient = async (
    providerName?: string,
  ): Promise<{ provider: ProviderConfig; client: LlmClient }> => {
    const store = await loadProviderStore(dependencies.homeDir);
    const provider = resolveProvider(store, providerName);

    if (dependencies.llmClient) {
      return { provider, client: dependencies.llmClient };
    }

    let client = clientCache.get(provider.name);
    if (!client) {
      client = new LLMClient(provider);
      clientCache.set(provider.name, client);
    }

    return { provider, client };
  };

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
      const { provider, client } = await resolveProviderAndClient(options.providerName);

      const messages = buildWriteMessages({
        chapterNumber: target.number,
        settings,
        previousChapters,
        intent: options.intent,
      });

      const content = await streamAndCollectText(client, messages, options.onText);
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
      const { provider, client } = await resolveProviderAndClient(options.providerName);

      const messages = buildCompleteMessages({
        chapterNumber: target.number,
        settings,
        chapter,
        intent: options.intent,
      });

      const content = await streamAndCollectText(client, messages, options.onText);
      ensureNonEmptyGeneratedText(content, 'complete chapter');
      await writeChapterFile(target.path, content);

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
      const worldState = getSettingContent(settings, WORLD_STATE_FILENAME);
      const characters = getSettingContent(settings, CHARACTERS_FILENAME);
      const { provider, client } = await resolveProviderAndClient(options.providerName);

      const rawResponse = await client.generateText({
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
      await writeTrackedSetting(bookPath, WORLD_STATE_FILENAME, ensureTrailingNewline(update.world_state));
      await writeTrackedSetting(bookPath, CHARACTERS_FILENAME, ensureTrailingNewline(update.characters));

      return {
        book_id: bookId,
        updated_files: [`settings/${WORLD_STATE_FILENAME}`, `settings/${CHARACTERS_FILENAME}`],
      };
    },
  };
}

function getSettingContent(settings: LoadedSetting[], filename: string): string {
  const setting = settings.find((item) => item.filename === filename);
  if (!setting) {
    throw new NibotError(`Missing ${filename} in settings.`, {
      code: 'INVALID_BOOK_WORKSPACE',
    });
  }
  return setting.content;
}

async function streamAndCollectText(
  llmClient: LlmClient,
  messages: ChatMessage[],
  onText?: (chunk: string) => void,
): Promise<string> {
  let content = '';

  for await (const chunk of llmClient.streamText({ messages })) {
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
