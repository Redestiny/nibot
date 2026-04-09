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

    const response = await this.callStreamApi({
      ...body,
      ...streamOptions,
    });

    const stream = response as unknown as AsyncIterable<unknown>;

    try {
      for await (const event of stream) {
        const delta = this.extractStreamDelta(event);
        if (delta) {
          yield delta;
        }
      }
    } catch (error) {
      throw new NibotError(`Streaming completion failed via provider "${this.provider.name}".`, {
        code: 'LLM_STREAM_FAILED',
        cause: error,
      });
    }
  }

  public async generateText(request: LlmGenerateRequest): Promise<string> {
    const { body } = this.buildRequest(request.messages);

    try {
      const response = await this.callApi(body);
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
      throw new NibotError(`Completion failed via provider "${this.provider.name}".`, {
        code: 'LLM_COMPLETION_FAILED',
        cause: error,
      });
    }
  }

  protected abstract callApi(body: Record<string, unknown>): Promise<unknown>;

  protected abstract callStreamApi(
    body: Record<string, unknown>,
  ): Promise<unknown>;
}
