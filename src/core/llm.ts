import OpenAI from 'openai';

import { NibotError } from './errors.js';
import type {
  ChatMessage,
  LlmClient,
  LlmGenerateRequest,
  LlmStreamRequest,
} from './types.js';

export class OpenAiCompatibleLlmClient implements LlmClient {
  public async *streamText(request: LlmStreamRequest): AsyncIterable<string> {
    const client = createOpenAiClient(request.provider.api_key, request.provider.base_url);

    let stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>;
    try {
      stream = await client.responses.create({
        model: request.provider.model,
        ...toResponsesRequest(request.messages),
        stream: true,
      });
    } catch (error) {
      throw new NibotError(`Failed to start streaming completion via provider "${request.provider.name}".`, {
        code: 'LLM_STREAM_START_FAILED',
        cause: error,
      });
    }

    try {
      for await (const chunk of stream) {
        const text = extractStreamChunkText(chunk);
        if (text.length > 0) {
          yield text;
        }
      }
    } catch (error) {
      throw new NibotError(`Streaming completion failed via provider "${request.provider.name}".`, {
        code: 'LLM_STREAM_FAILED',
        cause: error,
      });
    }
  }

  public async generateText(request: LlmGenerateRequest): Promise<string> {
    const client = createOpenAiClient(request.provider.api_key, request.provider.base_url);

    try {
      const response = await client.responses.create({
        model: request.provider.model,
        ...toResponsesRequest(request.messages),
      });

      const text = response.output_text;

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

      throw new NibotError(`Completion failed via provider "${request.provider.name}".`, {
        code: 'LLM_COMPLETION_FAILED',
        cause: error,
      });
    }
  }
}

function createOpenAiClient(apiKey: string, baseUrl: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: baseUrl,
  });
}

function toResponsesRequest(messages: ChatMessage[]): {
  input?: OpenAI.Responses.ResponseInput;
  instructions?: string;
} {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const input = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  return {
    ...(input.length > 0 ? { input } : {}),
    ...(instructions.length > 0 ? { instructions } : {}),
  };
}

function extractStreamChunkText(event: OpenAI.Responses.ResponseStreamEvent): string {
  if (event.type !== 'response.output_text.delta') {
    return '';
  }

  return event.delta;
}
