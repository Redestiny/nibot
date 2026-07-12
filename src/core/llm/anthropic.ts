import { Anthropic } from '@anthropic-ai/sdk';

import type { ChatMessage, ProviderConfig } from '../types.js';

import { LlmClientBase } from './base.js';

export class AnthropicClient extends LlmClientBase {
  private static readonly DEFAULT_MAX_TOKENS = 8192;

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
      max_tokens: this.provider.max_tokens ?? AnthropicClient.DEFAULT_MAX_TOKENS,
    };

    if (system) {
      body.system = [{
        type: 'text' as const,
        text: system,
        cache_control: { type: 'ephemeral' as const },
      }];
    }

    return { body, streamOptions: {} };
  }

  protected extractText(response: unknown): string {
    const resp = response as {
      content: Array<{ type: string; text?: string }>;
    };
    const textBlock = resp.content.find((block) => block.type === 'text');
    return textBlock?.text ?? '';
  }

  protected extractStreamDelta(event: unknown): string | null {
    const e = event as { type: string; delta?: { type: string; text?: string } };
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) {
      return e.delta.text;
    }
    return null;
  }

  protected override checkResponse(response: unknown): void {
    const resp = response as { stop_reason?: string };
    if (resp.stop_reason === 'max_tokens') {
      throw this.truncationError();
    }
  }

  protected override inspectStreamEvent(event: unknown): void {
    const e = event as { type: string; delta?: { stop_reason?: string } };
    if (e.type === 'message_delta' && e.delta?.stop_reason === 'max_tokens') {
      throw this.truncationError();
    }
  }

  protected async callApi(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const anthropic = this.getClient();
    const request = body as unknown as Parameters<(typeof anthropic)['messages']['create']>[0];
    return signal
      ? anthropic.messages.create(request, { signal })
      : anthropic.messages.create(request);
  }

  protected async callStreamApi(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const anthropic = this.getClient();
    const request = body as Parameters<(typeof anthropic)['messages']['stream']>[0];
    return signal
      ? anthropic.messages.stream(request, { signal })
      : anthropic.messages.stream(request);
  }

  private getClient(): Anthropic {
    this.client ??= new Anthropic({
      baseURL: this.provider.base_url,
      apiKey: this.provider.api_key,
    });
    return this.client;
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
