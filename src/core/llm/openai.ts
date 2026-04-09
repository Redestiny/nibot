import { OpenAI } from 'openai';

import type { ChatMessage, ProviderConfig } from '../types.js';

import { LlmClientBase } from './base.js';

export class OpenAiClient extends LlmClientBase {
  constructor(provider: ProviderConfig, private client?: OpenAI) {
    super(provider);
  }

  protected buildRequest(messages: ChatMessage[]): {
    body: Record<string, unknown>;
    streamOptions: Record<string, unknown>;
  } {
    const { instructions, input } = toResponsesRequest(messages);

    const body: Record<string, unknown> = {
      model: this.provider.model,
      input,
    };

    if (instructions) {
      body.instructions = instructions;
    }

    return {
      body,
      streamOptions: { stream: true },
    };
  }

  protected extractText(response: unknown): string {
    const resp = response as { output_text?: string };
    return resp.output_text ?? '';
  }

  protected extractStreamDelta(event: unknown): string | null {
    const e = event as { type: string; delta?: string };
    if (e.type === 'response.output_text.delta' && e.delta) {
      return e.delta;
    }
    return null;
  }

  protected async callApi(body: Record<string, unknown>): Promise<unknown> {
    const openai = this.client ?? new OpenAI({
      baseURL: this.provider.base_url,
      apiKey: this.provider.api_key,
    });

    return (openai as OpenAI).responses.create(body as Parameters<(typeof openai)['responses']['create']>[0]);
  }

  protected async callStreamApi(
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const openai = this.client ?? new OpenAI({
      baseURL: this.provider.base_url,
      apiKey: this.provider.api_key,
    });

    return (openai as OpenAI).responses.create(
      body as Parameters<(typeof openai)['responses']['create']>[0],
    );
  }
}

function toResponsesRequest(messages: ChatMessage[]): {
  input: { role: 'user' | 'assistant' | 'developer'; content: string; type: 'message' }[];
  instructions: string | undefined;
} {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n') || undefined;

  const input = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role as 'user' | 'assistant' | 'developer',
      content: message.content,
      type: 'message' as const,
    }));

  return { input, instructions };
}
