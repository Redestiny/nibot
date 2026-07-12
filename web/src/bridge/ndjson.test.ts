import { describe, expect, it } from 'vitest';

import { createNdjsonParser } from './ndjson';

interface TestEvent {
  type: string;
  chunk?: string;
}

function collect(chunks: string[]): TestEvent[] {
  const events: TestEvent[] = [];
  const parser = createNdjsonParser<TestEvent>((event) => events.push(event));
  for (const chunk of chunks) {
    parser.push(chunk);
  }
  parser.finish();
  return events;
}

describe('createNdjsonParser', () => {
  it('parses one event per line', () => {
    expect(collect(['{"type":"text","chunk":"一"}\n{"type":"done"}\n'])).toEqual([
      { type: 'text', chunk: '一' },
      { type: 'done' },
    ]);
  });

  it('handles a line split across chunks, including inside multibyte text', () => {
    expect(
      collect(['{"type":"te', 'xt","chunk":"第一', '段"}\n{"type":"done"}\n']),
    ).toEqual([{ type: 'text', chunk: '第一段' }, { type: 'done' }]);
  });

  it('handles multiple events arriving in a single chunk', () => {
    expect(
      collect(['{"type":"text","chunk":"一"}\n{"type":"text","chunk":"二"}\n{"type":"done"}\n']),
    ).toEqual([
      { type: 'text', chunk: '一' },
      { type: 'text', chunk: '二' },
      { type: 'done' },
    ]);
  });

  it('emits a trailing line without a newline on finish', () => {
    expect(collect(['{"type":"text","chunk":"一"}\n{"type":"done"}'])).toEqual([
      { type: 'text', chunk: '一' },
      { type: 'done' },
    ]);
  });

  it('ignores blank lines', () => {
    expect(collect(['\n\n{"type":"done"}\n\n'])).toEqual([{ type: 'done' }]);
  });
});
