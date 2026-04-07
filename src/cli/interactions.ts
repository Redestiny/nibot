import { createInterface } from 'node:readline/promises';

import type { ProviderConfig, ProviderType } from '../core/types.js';

export interface CliStreams {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export async function promptForProvider(
  io: CliStreams,
  jsonMode: boolean,
): Promise<ProviderConfig> {
  const rl = createInterface({
    input: io.stdin,
    output: jsonMode ? io.stderr : io.stdout,
  });

  try {
    let type: ProviderType = 'openai';
    let typeAnswer = (await rl.question('Provider type (openai/anthropic): ')).trim().toLowerCase();

    if (typeAnswer !== 'anthropic' && typeAnswer !== 'openai') {
      io.stderr.write(`Invalid provider type "${typeAnswer}". Must be "openai" or "anthropic".\n`);
      typeAnswer = (await rl.question('Provider type (openai/anthropic): ')).trim().toLowerCase();
    }

    type = typeAnswer as ProviderType;

    const name = (await rl.question('Provider name: ')).trim();
    const baseUrl = (await rl.question('Base URL: ')).trim();
    const apiKey = (await rl.question('API key: ')).trim();
    const model = (await rl.question('Model: ')).trim();

    return {
      type,
      name,
      base_url: baseUrl,
      api_key: apiKey,
      model,
    };
  } finally {
    rl.close();
  }
}

export async function confirmAction(
  io: CliStreams,
  jsonMode: boolean,
  prompt: string,
): Promise<boolean> {
  const rl = createInterface({
    input: io.stdin,
    output: jsonMode ? io.stderr : io.stdout,
  });

  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
