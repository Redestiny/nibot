// TYPES ONLY. This file must stay free of runtime code and `node:` imports:
// it is shared between the Node server (NodeNext resolution) and the web
// renderer (bundler resolution), and later an Electron preload will implement
// `NibotBridge` over IPC and expose it as `window.nibotBridge`.

export type ProviderType = 'anthropic' | 'openai';

export type SettingFilename = 'outline.md' | 'world_state.md' | 'characters.md';

export interface BridgeError {
  code: string;
  message: string;
}

export interface BookSummaryDto {
  id: string;
  title: string;
  lang: string;
  created_at: string;
  path: string;
  chapter_count: number;
  latest_chapter: string | null;
}

export interface BookStatusDto extends BookSummaryDto {
  settings_files: string[];
}

export interface ChapterSummaryDto {
  number: number;
  filename: string;
}

export interface ChapterDto extends ChapterSummaryDto {
  content: string;
}

export interface SaveChapterResult {
  book_id: string;
  chapter: number;
  filename: string;
  bytes: number;
  created: boolean;
}

export interface SettingDto {
  filename: string;
  content: string;
}

export interface ProviderInput {
  type: ProviderType;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  max_tokens?: number;
}

export interface ProviderView {
  name: string;
  base_url: string;
  model: string;
  api_key: string; // masked by core; the real key never crosses the bridge
  is_default: boolean;
}

export interface ProviderListDto {
  default_provider: string | null;
  providers: ProviderView[];
}

export interface GenerateRequest {
  chapter?: number;
  intent?: string;
  provider?: string;
}

export interface GenerateResult {
  action: 'write' | 'complete';
  book_id: string;
  chapter: number;
  filename: string;
  provider: string;
  bytes: number;
}

export interface GenerationHandlers {
  onText(chunk: string): void;
}

// NDJSON wire format used by the HTTP bridge implementation. The server emits
// one JSON object per line; `done`/`error` is always the final event.
export type GenerateStreamEvent =
  | { type: 'text'; chunk: string }
  | { type: 'done'; result: GenerateResult }
  | { type: 'error'; error: BridgeError };

export interface SyncUpdateDto {
  world_state: string;
  characters: string;
  summary?: string;
}

export interface SyncPreviewDto {
  book_id: string;
  chapter: number;
  provider: string;
  diff: string;
  changed_files: string[];
  update: SyncUpdateDto;
  summary?: string;
}

export interface NibotBridge {
  // books
  listBooks(): Promise<BookSummaryDto[]>;
  createBook(bookId: string): Promise<BookStatusDto>;
  getBookStatus(bookId: string): Promise<BookStatusDto>;
  // chapters
  listChapters(bookId: string): Promise<ChapterSummaryDto[]>;
  getChapter(bookId: string, chapter: number): Promise<ChapterDto>;
  saveChapter(bookId: string, chapter: number, content: string): Promise<SaveChapterResult>;
  // settings
  getSettings(bookId: string): Promise<SettingDto[]>;
  saveSetting(bookId: string, filename: SettingFilename, content: string): Promise<void>;
  // AI generation
  writeChapter(
    bookId: string,
    request: GenerateRequest,
    handlers: GenerationHandlers,
    signal?: AbortSignal,
  ): Promise<GenerateResult>;
  completeChapter(
    bookId: string,
    request: GenerateRequest,
    handlers: GenerationHandlers,
    signal?: AbortSignal,
  ): Promise<GenerateResult>;
  prepareSync(bookId: string, provider?: string, signal?: AbortSignal): Promise<SyncPreviewDto>;
  applySync(bookId: string, update: SyncUpdateDto): Promise<{ updated_files: string[] }>;
  // providers
  listProviders(): Promise<ProviderListDto>;
  addProvider(input: ProviderInput): Promise<ProviderListDto>;
  setDefaultProvider(name: string): Promise<ProviderListDto>;
  removeProvider(name: string): Promise<ProviderListDto>;
}
