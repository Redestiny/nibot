import { Anthropic } from '@anthropic-ai/sdk';

import type { ChatMessage, ProviderConfig } from '../types.js';

import { LlmClientBase } from './base.js';

export class AnthropicClient extends LlmClientBase {
  private static readonly DEFAULT_MAX_TOKENS = 4096;

  constructor(provider: ProviderConfig, private client?: Anthropic) {
    super(provider);
  }

  protected buildRequest(messages: ChatMessage[]): {
    body: Record<string, unknown>;
    streamOptions: Record<string, unknown>;
  } {
    const { system, nonSystemMessages } = extractSystemPrompt(messages);

    const body: Record<string, unknown> = {
      model: this.provider.model,
      messages: nonSystemMessages,
      max_tokens: AnthropicClient.DEFAULT_MAX_TOKENS,
    };

    if (system) {
      body.system = system;
    }

    return { body, streamOptions: {} };
  }

  protected extractText(response: unknown): string {
    const resp = response as {
      content: Array<{ type: string; text?: string }>;
    };
    return resp.content[0]?.type === 'text' ? (resp.content[0].text ?? '') : '';
  }

  protected extractStreamDelta(event: unknown): string | null {
    const e = event as { type: string; delta?: { type: string; text?: string } };
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) {
      return e.delta.text;
    }
    return null;
  }

  protected async callApi(body: Record<string, unknown>): Promise<unknown> {
    const anthropic = this.client ?? new Anthropic({
      baseURL: this.provider.base_url,
      apiKey: this.provider.api_key,
    });

    return (anthropic as Anthropic).messages.create(
      body as unknown as Parameters<(typeof anthropic)['messages']['create']>[0],
    );
  }

  protected async callStreamApi(
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const anthropic = this.client ?? new Anthropic({
      baseURL: this.provider.base_url,
      apiKey: this.provider.api_key,
    });

    return (anthropic as Anthropic).messages.stream(
      body as Parameters<(typeof anthropic)['messages']['stream']>[0],
    );
  }
}

function extractSystemPrompt(messages: ChatMessage[]): {
  system: string | undefined;
  nonSystemMessages: { role: 'user' | 'assistant'; content: string }[];
} {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');

  const system = systemMessages.length > 0
    ? systemMessages.map((m) => m.content).join('\n\n')
    : undefined;

  const nonSystemMessages = nonSystem.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  return { system, nonSystemMessages };
}
