import type {
  BookStatusDto,
  BookSummaryDto,
  BridgeError,
  ChapterDto,
  ChapterSummaryDto,
  GenerateRequest,
  GenerateResult,
  GenerateStreamEvent,
  GenerationHandlers,
  NibotBridge,
  ProviderInput,
  ProviderListDto,
  SaveChapterResult,
  SettingDto,
  SettingFilename,
  SyncPreviewDto,
  SyncUpdateDto,
} from '@shared/bridge';

import { readNdjsonStream } from './ndjson';

export class NibotBridgeError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'NibotBridgeError';
    this.code = code;
  }
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON body; fall through to the status check below.
  }

  if (!response.ok) {
    const error = (payload as { error?: BridgeError } | null)?.error;
    throw new NibotBridgeError(
      error?.code ?? `HTTP_${response.status}`,
      error?.message ?? `请求失败（HTTP ${response.status}）。`,
    );
  }

  return payload as T;
}

function bookPath(bookId: string, suffix = ''): string {
  return `/api/books/${encodeURIComponent(bookId)}${suffix}`;
}

class HttpBridge implements NibotBridge {
  public listBooks(): Promise<BookSummaryDto[]> {
    return requestJson('/api/books');
  }

  public createBook(bookId: string): Promise<BookStatusDto> {
    return requestJson('/api/books', jsonInit('POST', { book_id: bookId }));
  }

  public getBookStatus(bookId: string): Promise<BookStatusDto> {
    return requestJson(bookPath(bookId, '/status'));
  }

  public listChapters(bookId: string): Promise<ChapterSummaryDto[]> {
    return requestJson(bookPath(bookId, '/chapters'));
  }

  public getChapter(bookId: string, chapter: number): Promise<ChapterDto> {
    return requestJson(bookPath(bookId, `/chapters/${chapter}`));
  }

  public saveChapter(bookId: string, chapter: number, content: string): Promise<SaveChapterResult> {
    return requestJson(bookPath(bookId, `/chapters/${chapter}`), jsonInit('PUT', { content }));
  }

  public getSettings(bookId: string): Promise<SettingDto[]> {
    return requestJson(bookPath(bookId, '/settings'));
  }

  public async saveSetting(
    bookId: string,
    filename: SettingFilename,
    content: string,
  ): Promise<void> {
    await requestJson(bookPath(bookId, `/settings/${filename}`), jsonInit('PUT', { content }));
  }

  public writeChapter(
    bookId: string,
    request: GenerateRequest,
    handlers: GenerationHandlers,
    signal?: AbortSignal,
  ): Promise<GenerateResult> {
    return this.generate(bookPath(bookId, '/write'), request, handlers, signal);
  }

  public completeChapter(
    bookId: string,
    request: GenerateRequest,
    handlers: GenerationHandlers,
    signal?: AbortSignal,
  ): Promise<GenerateResult> {
    return this.generate(bookPath(bookId, '/complete'), request, handlers, signal);
  }

  public prepareSync(
    bookId: string,
    provider?: string,
    signal?: AbortSignal,
  ): Promise<SyncPreviewDto> {
    return requestJson(bookPath(bookId, '/sync/prepare'), {
      ...jsonInit('POST', { provider }),
      signal,
    });
  }

  public applySync(bookId: string, update: SyncUpdateDto): Promise<{ updated_files: string[] }> {
    return requestJson(bookPath(bookId, '/sync/apply'), jsonInit('POST', { update }));
  }

  public listProviders(): Promise<ProviderListDto> {
    return requestJson('/api/providers');
  }

  public addProvider(input: ProviderInput): Promise<ProviderListDto> {
    return requestJson('/api/providers', jsonInit('POST', input));
  }

  public setDefaultProvider(name: string): Promise<ProviderListDto> {
    return requestJson('/api/providers/default', jsonInit('PUT', { name }));
  }

  public removeProvider(name: string): Promise<ProviderListDto> {
    return requestJson(`/api/providers/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  private async generate(
    path: string,
    request: GenerateRequest,
    handlers: GenerationHandlers,
    signal?: AbortSignal,
  ): Promise<GenerateResult> {
    try {
      const response = await fetch(path, { ...jsonInit('POST', request), signal });
      if (!response.ok || !response.body) {
        throw new NibotBridgeError(
          `HTTP_${response.status}`,
          `生成请求失败（HTTP ${response.status}）。`,
        );
      }

      let result: GenerateResult | null = null;
      let streamError: BridgeError | null = null;

      await readNdjsonStream<GenerateStreamEvent>(response.body, (event) => {
        if (event.type === 'text') {
          handlers.onText(event.chunk);
        } else if (event.type === 'done') {
          result = event.result;
        } else {
          streamError = event.error;
        }
      });

      if (streamError !== null) {
        const bridgeError: BridgeError = streamError;
        throw new NibotBridgeError(bridgeError.code, bridgeError.message);
      }
      if (result === null) {
        throw new NibotBridgeError('STREAM_INCOMPLETE', '生成流意外中断，未收到完成事件。');
      }
      return result;
    } catch (error) {
      // Aborting the fetch surfaces as a DOMException; normalize it so the UI
      // can treat user-initiated stops uniformly.
      if (signal?.aborted) {
        throw new NibotBridgeError('ABORTED', '已停止生成。');
      }
      throw error;
    }
  }
}

export const httpBridge: NibotBridge = new HttpBridge();
