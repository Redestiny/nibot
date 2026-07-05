import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { promptForProvider, type CliStreams } from './interactions.js';

// readline emits a "line" event as soon as a newline is parsed out of the
// input stream, regardless of whether anything is currently listening for
// it. Writing every answer up front means the later lines get emitted (and
// dropped) before promptForProvider has even asked for them, so each write
// is deferred a tick to let the previous `rl.question()` call be awaited
// and the next one registered first.
function feedLines(stdin: PassThrough, lines: string[]): void {
  void (async () => {
    for (const line of lines) {
      await new Promise((resolve) => setImmediate(resolve));
      stdin.write(`${line}\n`);
    }
  })();
}

function makeIo(lines: string[]): CliStreams {
  const stdin = new PassThrough();
  feedLines(stdin, lines);

  return {
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
}

describe('promptForProvider', () => {
  it('returns a trimmed provider config from valid answers', async () => {
    const io = makeIo([
      ' OpenAI ',
      ' my-provider ',
      ' https://api.example.com/v1 ',
      ' sk-test-123 ',
      ' gpt-4o ',
    ]);

    const result = await promptForProvider(io, false);

    expect(result).toEqual({
      type: 'openai',
      name: 'my-provider',
      base_url: 'https://api.example.com/v1',
      api_key: 'sk-test-123',
      model: 'gpt-4o',
    });
  });

  it('reprompts until a valid provider type is entered', async () => {
    const stderrChunks: string[] = [];
    const io = makeIo([
      'foo',
      'bar',
      'anthropic',
      'my-provider',
      'https://api.example.com/v1',
      'sk-test-123',
      'claude-x',
    ]);
    io.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));

    const result = await promptForProvider(io, false);

    expect(result.type).toBe('anthropic');
    const stderrOutput = stderrChunks.join('');
    expect(stderrOutput).toContain('Invalid provider type "foo"');
    expect(stderrOutput).toContain('Invalid provider type "bar"');
  });
});
