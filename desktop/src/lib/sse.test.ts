import { describe, it, expect } from "vitest";
import { ChatSSEParser, type SSEChatEvent } from "@/lib/sse";

/** Feed a whole SSE string through the parser and collect every event. */
function parseAll(chunks: string[]): SSEChatEvent[] {
  const p = new ChatSSEParser();
  const out: SSEChatEvent[] = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.end());
  return out;
}

function delta(content: string, finish?: string): string {
  const choice: Record<string, unknown> = { delta: { content } };
  if (finish) choice.finish_reason = finish;
  return `data: ${JSON.stringify({ choices: [choice] })}\n`;
}

describe("ChatSSEParser", () => {
  it("extracts token deltas in order", () => {
    const events = parseAll([delta("Hello"), delta(", "), delta("world")]);
    const tokens = events.filter((e) => e.type === "token").map((e) => e.text);
    expect(tokens).toEqual(["Hello", ", ", "world"]);
  });

  it("emits a done event on [DONE] and stops", () => {
    const events = parseAll([delta("hi"), "data: [DONE]\n", delta("ignored")]);
    expect(events.filter((e) => e.type === "token").map((e) => e.text)).toEqual([
      "hi",
    ]);
    const done = events.filter((e) => e.type === "done");
    expect(done).toHaveLength(1);
  });

  it("captures finish_reason and reports it on done", () => {
    const events = parseAll([delta("x", "length"), "data: [DONE]\n"]);
    const done = events.find((e) => e.type === "done");
    expect(done).toEqual({ type: "done", finishReason: "length" });
  });

  it("flushes a terminal done when the stream ends without [DONE]", () => {
    const events = parseAll([delta("only")]);
    expect(events[events.length - 1]).toEqual({
      type: "done",
      finishReason: "stop",
    });
  });

  it("reassembles a data line split across chunk boundaries", () => {
    const line = delta("split-token");
    const mid = Math.floor(line.length / 2);
    const events = parseAll([line.slice(0, mid), line.slice(mid)]);
    expect(events.filter((e) => e.type === "token").map((e) => e.text)).toEqual([
      "split-token",
    ]);
  });

  it("ignores keep-alive / non-data / empty-data lines", () => {
    const events = parseAll([
      ": keep-alive comment\n",
      "\n",
      "data: \n",
      "event: ping\n",
      delta("real"),
    ]);
    expect(events.filter((e) => e.type === "token").map((e) => e.text)).toEqual([
      "real",
    ]);
  });

  it("does not emit tokens for empty delta content", () => {
    const events = parseAll([delta(""), delta("kept")]);
    expect(events.filter((e) => e.type === "token").map((e) => e.text)).toEqual([
      "kept",
    ]);
  });

  it("survives malformed JSON without throwing", () => {
    const events = parseAll(["data: {not json}\n", delta("after")]);
    expect(events.filter((e) => e.type === "token").map((e) => e.text)).toEqual([
      "after",
    ]);
  });

  it("does not double-emit done when end() follows [DONE]", () => {
    const events = parseAll([delta("a"), "data: [DONE]\n"]);
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });
});
