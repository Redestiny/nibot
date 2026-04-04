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

    let stream: AsyncIterable<unknown>;
    try {
      stream = await client.chat.completions.create({
        model: request.provider.model,
        messages: toOpenAiMessages(request.messages),
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
      const response = await client.chat.completions.create({
        model: request.provider.model,
        messages: toOpenAiMessages(request.messages),
      });

      const content = response.choices[0]?.message?.content;
      const text = normalizeContent(content);

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

function toOpenAiMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function extractStreamChunkText(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') {
    return '';
  }

  const choice = (chunk as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0];
  return normalizeContent(choice?.delta?.content);
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return '';
        }

        const candidate = part as { text?: unknown };
        return typeof candidate.text === 'string' ? candidate.text : '';
      })
      .join('');
  }

  return '';
}
