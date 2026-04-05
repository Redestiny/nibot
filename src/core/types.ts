export interface BookMeta {
  id: string;
  title: string;
  created_at: string;
  lang: string;
}

export interface ProviderConfig {
  name: string;
  base_url: string;
  api_key: string;
  model: string;
}

export interface ProviderStore {
  providers: ProviderConfig[];
  default_provider?: string;
}

export interface LoadedSetting {
  filename: string;
  content: string;
}

export interface LoadedChapter {
  number: number;
  filename: string;
  path: string;
  content: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SyncUpdate {
  world_state: string;
  characters: string;
  summary?: string;
}

export interface LlmStreamRequest {
  provider: ProviderConfig;
  messages: ChatMessage[];
}

export interface LlmGenerateRequest extends LlmStreamRequest {}

export interface LlmClient {
  streamText(request: LlmStreamRequest): AsyncIterable<string>;
  generateText(request: LlmGenerateRequest): Promise<string>;
}

export interface WriteChapterOptions {
  bookId: string;
  chapter?: number;
  intent?: string;
  providerName?: string;
  onText?: (chunk: string) => void;
}

export interface CompleteChapterOptions extends WriteChapterOptions {}

export interface PrepareSyncOptions {
  bookId: string;
  providerName?: string;
}
