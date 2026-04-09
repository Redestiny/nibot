import type { LlmClient, LlmGenerateRequest, LlmStreamRequest, ProviderConfig } from '../types.js';

import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai';

import { LlmClientBase } from './base.js';
import { AnthropicClient } from './anthropic.js';
import { OpenAiClient } from './openai.js';

export class LLMClient implements LlmClient {
  private client: LlmClientBase;

  constructor(provider: ProviderConfig, sdkClient?: unknown) {
    if (provider.type === 'anthropic') {
      this.client = new AnthropicClient(provider, sdkClient as Anthropic);
    } else {
      this.client = new OpenAiClient(provider, sdkClient as OpenAI);
    }
  }

  public streamText(request: LlmStreamRequest): AsyncIterable<string> {
    return this.client.streamText(request);
  }

  public generateText(request: LlmGenerateRequest): Promise<string> {
    return this.client.generateText(request);
  }
}
