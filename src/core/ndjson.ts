/**
 * Reads newline-delimited JSON from a byte stream one line at a time, without
 * buffering the whole response. Handles lines split across chunks, CRLF, blank
 * keep-alive lines and multi-byte UTF-8 characters split across chunks.
 * Lines that aren't valid JSON are reported to `onBadLine` and skipped.
 */
export async function* readNdjson<T = unknown>(
  stream: ReadableStream<Uint8Array>,
  onBadLine?: (line: string, error: unknown) => void,
): AsyncGenerator<T> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const parse = function* (line: string): Generator<T> {
    const t = line.trim();
    if (!t) return;
    try {
      yield JSON.parse(t) as T;
    } catch (e) {
      onBadLine?.(t, e);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        yield* parse(line);
      }
    }
    buf += decoder.decode();
    yield* parse(buf);
  } finally {
    reader.releaseLock();
  }
}
