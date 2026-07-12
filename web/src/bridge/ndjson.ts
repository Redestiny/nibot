// Incremental NDJSON line parser: server chunks can split a JSON line at any
// byte, so events are only emitted once their terminating newline arrives.
export function createNdjsonParser<T>(onEvent: (event: T) => void): {
  push(chunk: string): void;
  finish(): void;
} {
  let buffer = '';

  const emitLine = (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      onEvent(JSON.parse(trimmed) as T);
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        emitLine(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
      }
    },
    finish() {
      emitLine(buffer);
      buffer = '';
    },
  };
}

export async function readNdjsonStream<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createNdjsonParser(onEvent);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.finish();
  } finally {
    reader.releaseLock();
  }
}
