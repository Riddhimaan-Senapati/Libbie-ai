// Incremental parser for an OpenAI-compatible chat-completions SSE stream.
//
// This is the single TypeScript implementation of "parse `data:` lines / detect
// `[DONE]` / pull `choices[0].delta.content`". It mirrors the Rust parser in
// `src-tauri/src/inference.rs` (the shipped path); the two are kept in lock-step,
// and this one is exercised directly by unit tests (`sse.test.ts`).

/** An event decoded from the chat SSE stream. */
export type SSEChatEvent =
  | { type: "token"; text: string }
  | { type: "done"; finishReason: string };

/**
 * Stateful, chunk-at-a-time SSE parser. Feed decoded string chunks to `push()`
 * (it buffers a partial trailing line across calls) and call `end()` once the
 * underlying stream closes to flush a terminal `done` if the server never sent
 * an explicit `[DONE]`.
 */
export class ChatSSEParser {
  private buf = "";
  private finishReason = "stop";
  private done = false;

  /** Consume a chunk, returning any complete events parsed from it. */
  push(chunk: string): SSEChatEvent[] {
    // Once the stream has terminated ([DONE] seen), ignore any trailing bytes.
    if (this.done) return [];
    const events: SSEChatEvent[] = [];
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      const evt = this.parseLine(line);
      if (evt) events.push(evt);
      if (this.done) break;
    }
    return events;
  }

  /** Flush end-of-stream. Emits a final `done` unless `[DONE]` already fired. */
  end(): SSEChatEvent[] {
    if (this.done) return [];
    this.done = true;
    return [{ type: "done", finishReason: this.finishReason }];
  }

  private parseLine(line: string): SSEChatEvent | null {
    if (!line.startsWith("data:")) return null;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      this.done = true;
      return { type: "done", finishReason: this.finishReason };
    }
    if (!data) return null;
    try {
      const json = JSON.parse(data);
      const choice = json.choices?.[0];
      if (choice?.finish_reason) this.finishReason = choice.finish_reason;
      const text = choice?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        return { type: "token", text };
      }
    } catch {
      /* ignore keep-alive / non-JSON lines */
    }
    return null;
  }
}
