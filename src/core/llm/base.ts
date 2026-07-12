import type { ChatMessage, LlmClient, LlmGenerateRequest, LlmStreamRequest } from '../types.js';
import type { ProviderConfig } from '../types.js';

import { NibotError } from '../errors.js';

export abstract class LlmClientBase implements LlmClient {
  constructor(protected provider: ProviderConfig) {}

  protected abstract buildRequest(messages: ChatMessage[]): {
    body: Record<string, unknown>;
    streamOptions?: Record<string, unknown>;
  };

  protected abstract extractText(response: unknown): string;

  protected abstract extractStreamDelta(event: unknown): string | null;

  public async *streamText(request: LlmStreamRequest): AsyncIterable<string> {
    const { body, streamOptions } = this.buildRequest(request.messages);

    try {
      const response = await this.callStreamApi(
        {
          ...body,
          ...streamOptions,
        },
        request.signal,
      );

      const stream = response as unknown as AsyncIterable<unknown>;

      for await (const event of stream) {
        // Some SDKs surface an aborted connection as a graceful end of stream
        // rather than an error; without this check a partial chapter would be
        // treated as complete and written to disk.
        if (request.signal?.aborted) {
          throw this.abortedError(undefined);
        }
        this.inspectStreamEvent(event);
        const delta = this.extractStreamDelta(event);
        if (delta) {
          yield delta;
        }
      }

      if (request.signal?.aborted) {
        throw this.abortedError(undefined);
      }
    } catch (error) {
      if (error instanceof NibotError) {
        throw error;
      }
      if (request.signal?.aborted) {
        throw this.abortedError(error);
      }
      throw new NibotError(`Streaming completion failed via provider "${this.provider.name}".`, {
        code: 'LLM_STREAM_FAILED',
        cause: error,
      });
    }
  }

  public async generateText(request: LlmGenerateRequest): Promise<string> {
    const { body } = this.buildRequest(request.messages);

    try {
      const response = await this.callApi(body, request.signal);
      this.checkResponse(response);
      const text = this.extractText(response);

      if (text.length === 0) {
        throw new NibotError('Model returned an empty response.', {
          code: 'EMPTY_LLM_RESPONSE',
        });
      }

      return text;
    } catch (error) {
      if (error instanceof NibotError) {
        throw error;
      }
      if (request.signal?.aborted) {
        throw this.abortedError(error);
      }
      throw new NibotError(`Completion failed via provider "${this.provider.name}".`, {
        code: 'LLM_COMPLETION_FAILED',
        cause: error,
      });
    }
  }

  protected abstract callApi(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;

  protected abstract callStreamApi(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;

  // Subclasses may throw here to reject a non-streaming response (e.g. truncation).
  protected checkResponse(_response: unknown): void {}

  // Subclasses may throw here to abort a stream on a fatal event (e.g. truncation).
  protected inspectStreamEvent(_event: unknown): void {}

  protected truncationError(): NibotError {
    return new NibotError(
      `Provider "${this.provider.name}" stopped early: the response hit the max_tokens limit. ` +
        'Increase "max_tokens" for this provider in the nibot config.',
      { code: 'LLM_RESPONSE_TRUNCATED' },
    );
  }

  private abortedError(cause?: unknown): NibotError {
    return new NibotError('Generation aborted.', {
      code: 'ABORTED',
      ...(cause === undefined ? {} : { cause }),
    });
  }
}
