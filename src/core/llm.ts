import { NibotError } from './errors.js';
import type {
  ChatMessage,
  LlmClient,
  LlmGenerateRequest,
  LlmStreamRequest,
  ProviderConfig,
} from './types.js';

export class OpenAiCompatibleLlmClient implements LlmClient {
  public async *streamText(request: LlmStreamRequest): AsyncIterable<string> {
    const { provider, messages } = request;

    const response = await fetch(`${provider.base_url}/responses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.api_key}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        model: provider.model,
        ...toResponsesRequest(messages),
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new NibotError(`Streaming request failed via provider "${provider.name}".`, {
        code: 'LLM_STREAM_START_FAILED',
        cause: await response.text(),
      });
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            const text = parseOpenAiStreamChunk(data);
            if (text) {
              yield text;
            }
          }
        }
      }
    } catch (error) {
      throw new NibotError(`Streaming completion failed via provider "${provider.name}".`, {
        code: 'LLM_STREAM_FAILED',
        cause: error,
      });
    }
  }

  public async generateText(request: LlmGenerateRequest): Promise<string> {
    const { provider, messages } = request;

    const response = await fetch(`${provider.base_url}/responses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        ...toResponsesRequest(messages),
      }),
    });

    if (!response.ok) {
      throw new NibotError(`Completion failed via provider "${provider.name}".`, {
        code: 'LLM_COMPLETION_FAILED',
        cause: await response.text(),
      });
    }

    const json = await response.json() as { output_text?: string };
    const text = json.output_text ?? '';

    if (text.length === 0) {
      throw new NibotError('Model returned an empty response.', {
        code: 'EMPTY_LLM_RESPONSE',
      });
    }

    return text;
  }
}

function toResponsesRequest(messages: ChatMessage[]): {
  input?: Array<{ role: string; content: string }>;
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

function parseOpenAiStreamChunk(data: string): string {
  try {
    const event = JSON.parse(data);
    if (event.type === 'response.output_text.delta') {
      return event.delta ?? '';
    }
    return '';
  } catch {
    return '';
  }
}

export class AnthropicLlmClient implements LlmClient {
  private static readonly DEFAULT_MAX_TOKENS = 4096;

  public async *streamText(request: LlmStreamRequest): AsyncIterable<string> {
    const { provider, messages } = request;
    const { system, nonSystemMessages } = extractSystemPrompt(messages);

    let response: Response;
    try {
      response = await fetch(`${provider.base_url}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': provider.api_key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'accept': 'text/event-stream',
        },
        body: JSON.stringify({
          model: provider.model,
          ...(system ? { system } : {}),
          messages: nonSystemMessages,
          max_tokens: AnthropicLlmClient.DEFAULT_MAX_TOKENS,
          stream: true,
        }),
      });
    } catch (error) {
      throw new NibotError(`Streaming request failed via provider "${provider.name}".`, {
        code: 'LLM_STREAM_START_FAILED',
        cause: error,
      });
    }

    if (!response.ok) {
      let cause: string;
      try {
        cause = await response.text();
      } catch {
        cause = `HTTP ${response.status}`;
      }
      throw new NibotError(`Streaming request failed via provider "${provider.name}".`, {
        code: 'LLM_STREAM_START_FAILED',
        cause,
      });
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            const text = parseAnthropicStreamChunk(data);
            if (text) {
              yield text;
            }
          }
        }
      }
    } catch (error) {
      throw new NibotError(`Streaming completion failed via provider "${provider.name}".`, {
        code: 'LLM_STREAM_FAILED',
        cause: error,
      });
    }
  }

  public async generateText(request: LlmGenerateRequest): Promise<string> {
    const { provider, messages } = request;
    const { system, nonSystemMessages } = extractSystemPrompt(messages);

    let response: Response;
    try {
      response = await fetch(`${provider.base_url}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': provider.api_key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          ...(system ? { system } : {}),
          messages: nonSystemMessages,
          max_tokens: AnthropicLlmClient.DEFAULT_MAX_TOKENS,
        }),
      });
    } catch (error) {
      throw new NibotError(`Completion failed via provider "${provider.name}".`, {
        code: 'LLM_COMPLETION_FAILED',
        cause: error,
      });
    }

    if (!response.ok) {
      let cause: string;
      try {
        cause = await response.text();
      } catch {
        cause = `HTTP ${response.status}`;
      }
      throw new NibotError(`Completion failed via provider "${provider.name}".`, {
        code: 'LLM_COMPLETION_FAILED',
        cause,
      });
    }

    let json: { content?: Array<{ type: string; text?: string }> };
    try {
      json = await response.json();
    } catch (error) {
      throw new NibotError(`Failed to parse response from provider "${provider.name}".`, {
        code: 'LLM_COMPLETION_FAILED',
        cause: error,
      });
    }

    const text = json.content?.[0]?.text ?? '';

    if (text.length === 0) {
      throw new NibotError('Model returned an empty response.', {
        code: 'EMPTY_LLM_RESPONSE',
      });
    }

    return text;
  }
}

function extractSystemPrompt(messages: ChatMessage[]): {
  system: string | undefined;
  nonSystemMessages: Array<{ role: string; content: string }>;
} {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');

  const system = systemMessages.length > 0
    ? systemMessages.map((m) => m.content).join('\n\n')
    : undefined;

  const nonSystemMessages = nonSystem.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  return { system, nonSystemMessages };
}

function parseAnthropicStreamChunk(data: string): string {
  try {
    const event = JSON.parse(data);
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      return event.delta.text ?? '';
    }
    return '';
  } catch {
    return '';
  }
}

export class MultiLlmClient implements LlmClient {
  constructor(
    private openAiClient = new OpenAiCompatibleLlmClient(),
    private anthropicClient = new AnthropicLlmClient(),
  ) {}

  public async *streamText(request: LlmStreamRequest): AsyncIterable<string> {
    const client = this.selectClient(request.provider);
    yield* client.streamText(request);
  }

  public async generateText(request: LlmGenerateRequest): Promise<string> {
    const client = this.selectClient(request.provider);
    return client.generateText(request);
  }

  private selectClient(provider: ProviderConfig): LlmClient {
    if (provider.type === 'anthropic') {
      return this.anthropicClient;
    }
    return this.openAiClient;
  }
}
