// Typed bridge to the Rust core.
//
// Two runtimes are supported by the SAME UI:
//   * Tauri (production): commands are invoked over IPC; the Rust core owns the
//     engine lifecycle and proxies all inference, so the webview never hits the
//     network.
//   * Browser dev (no Tauri): the client talks directly to a local llama-server
//     over loopback, so the full experience can be developed/verified in a
//     normal browser. This path is dev-only; the shipped app always uses IPC.

export interface AppConfig {
  llama_binary: string | null;
  vllm_binary: string | null;
  models_dir: string;
  chat_model: string | null;
  embed_model: string | null;
  host: string;
  chat_port: number;
  embed_port: number;
  offline_mode: boolean;
  gpu_layers: number;
  ctx_size: number;
  preferred_engine: "auto" | "llama" | "vllm";
}

export interface HardwareInfo {
  os: string;
  arch: string;
  cpu_count: number;
  total_mem_mb: number;
  has_nvidia: boolean;
  gpu_names: string[];
  llama_backend: string;
}

export interface EngineChoice {
  engine: "llama" | "vllm";
  reason: string;
}

export interface EngineStatus {
  running: boolean;
  healthy: boolean;
  engine: "llama" | "vllm" | null;
  model: string | null;
  base_url: string | null;
  pid: number | null;
  message: string;
}

export interface ModelEntry {
  name: string;
  path: string;
  size_mb: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "done"; finishReason: string }
  | { type: "error"; message: string };

/** A KNN result row from the vector store (mirrors Rust `Hit`). */
export interface Hit {
  id: number;
  path: string;
  kind: string;
  line_start: number;
  conv_id: string;
  distance: number;
  similarity: number;
}

/** A corpus chunk to embed + index (mirrors Rust `Chunk`). */
export interface Chunk {
  text: string;
  path: string | null;
  kind: string;
  line_start: number;
  conv_id: string | null;
}

export interface IndexStatus {
  indexed: boolean;
  count: number;
  dim: number | null;
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Dev-mode default endpoint (matches AppConfig defaults).
const DEV_BASE_URL = "http://127.0.0.1:51820";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEV_CONFIG_KEY = "libbie.devConfig";

function devConfig(): AppConfig {
  const stored = localStorage.getItem(DEV_CONFIG_KEY);
  const base: AppConfig = {
    llama_binary: null,
    vllm_binary: null,
    models_dir: "(browser dev)",
    chat_model: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    embed_model: null,
    host: "127.0.0.1",
    chat_port: 51820,
    embed_port: 51821,
    offline_mode: true,
    gpu_layers: -1,
    ctx_size: 8192,
    preferred_engine: "auto",
  };
  return stored ? { ...base, ...JSON.parse(stored) } : base;
}

export async function getConfig(): Promise<AppConfig> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AppConfig>("get_config");
  }
  return devConfig();
}

export async function setConfig(config: AppConfig): Promise<AppConfig> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AppConfig>("set_config", { config });
  }
  localStorage.setItem(DEV_CONFIG_KEY, JSON.stringify(config));
  return config;
}

// ---------------------------------------------------------------------------
// Hardware / engine
// ---------------------------------------------------------------------------

export async function getHardware(): Promise<HardwareInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<HardwareInfo>("get_hardware");
  }
  return {
    os: "browser",
    arch: navigator.userAgent.includes("Win") ? "x86_64" : "unknown",
    cpu_count: navigator.hardwareConcurrency || 0,
    total_mem_mb: 0,
    has_nvidia: false,
    gpu_names: [],
    llama_backend: "external (dev)",
  };
}

export async function getEngineChoice(): Promise<EngineChoice> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<EngineChoice>("get_engine_choice");
  }
  return { engine: "llama", reason: "Browser dev: external llama-server." };
}

export async function engineStatus(): Promise<EngineStatus> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<EngineStatus>("engine_status");
  }
  // Dev: probe the external server's health directly.
  const cfg = devConfig();
  const base = `http://${cfg.host}:${cfg.chat_port}`;
  try {
    const r = await fetch(`${base}/health`);
    const healthy = r.ok && (await r.text()).includes("ok");
    return {
      running: healthy,
      healthy,
      engine: "llama",
      model: cfg.chat_model,
      base_url: base,
      pid: null,
      message: healthy ? "External llama-server ready (dev)" : "No engine on loopback",
    };
  } catch {
    return {
      running: false,
      healthy: false,
      engine: null,
      model: null,
      base_url: base,
      pid: null,
      message: "No engine reachable on loopback",
    };
  }
}

export async function startEngine(): Promise<EngineStatus> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<EngineStatus>("start_engine");
  }
  // Dev: the server is managed outside the browser; just report status.
  return engineStatus();
}

export async function stopEngine(): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_engine");
    return;
  }
}

export async function listModels(): Promise<ModelEntry[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ModelEntry[]>("list_models");
  }
  const cfg = devConfig();
  return cfg.chat_model
    ? [{ name: cfg.chat_model, path: cfg.chat_model, size_mb: 0 }]
    : [];
}

// ---------------------------------------------------------------------------
// Inference — streaming chat
// ---------------------------------------------------------------------------

export interface AskHandlers {
  onToken: (text: string) => void;
  onDone: (finishReason: string) => void;
  onError: (message: string) => void;
}

/**
 * Stream a grounded chat completion. Uses IPC + a Tauri Channel in the app, or
 * a direct loopback SSE fetch in browser dev.
 */
export async function askLibbie(
  messages: ChatMessage[],
  options: ChatOptions,
  handlers: AskHandlers,
): Promise<void> {
  if (isTauri()) {
    const { invoke, Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<StreamEvent>();
    channel.onmessage = (evt) => {
      if (evt.type === "token") handlers.onToken(evt.text);
      else if (evt.type === "done") handlers.onDone(evt.finishReason);
      else if (evt.type === "error") handlers.onError(evt.message);
    };
    await invoke("ask_libbie", { messages, options, onEvent: channel });
    return;
  }
  await devStreamChat(messages, options, handlers);
}

async function devStreamChat(
  messages: ChatMessage[],
  options: ChatOptions,
  handlers: AskHandlers,
): Promise<void> {
  const cfg = devConfig();
  const url = `http://${cfg.host}:${cfg.chat_port}/v1/chat/completions`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages,
        stream: true,
        temperature: options.temperature ?? 0.2,
        top_p: options.top_p ?? 0.9,
        max_tokens: options.max_tokens ?? 768,
      }),
    });
  } catch (e) {
    handlers.onError(`Could not reach the local engine: ${String(e)}`);
    return;
  }
  if (!resp.ok || !resp.body) {
    handlers.onError(`Engine returned ${resp.status}`);
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finish = "stop";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        handlers.onDone(finish);
        return;
      }
      if (!data) continue;
      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const text = choice?.delta?.content;
        if (text) handlers.onToken(text);
      } catch {
        /* ignore keep-alive lines */
      }
    }
  }
  handlers.onDone(finish);
}

// ---------------------------------------------------------------------------
// Embeddings (RAG index) — optional; requires an embedding engine.
// ---------------------------------------------------------------------------

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<number[][]>("embed_texts", { inputs });
  }
  const cfg = devConfig();
  const url = `http://${cfg.host}:${cfg.embed_port}/v1/embeddings`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", input: inputs }),
  });
  if (!r.ok) throw new Error(`Embedding engine returned ${r.status}`);
  const json = await r.json();
  return (json.data ?? []).map((d: { embedding: number[] }) => d.embedding);
}

// ---------------------------------------------------------------------------
// Embedding engine lifecycle
// ---------------------------------------------------------------------------

export async function startEmbedEngine(): Promise<EngineStatus> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<EngineStatus>("start_embed_engine");
  }
  return embedEngineStatus();
}

export async function stopEmbedEngine(): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_embed_engine");
  }
}

export async function embedEngineStatus(): Promise<EngineStatus> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<EngineStatus>("embed_engine_status");
  }
  const cfg = devConfig();
  const base = `http://${cfg.host}:${cfg.embed_port}`;
  try {
    const r = await fetch(`${base}/health`);
    const healthy = r.ok && (await r.text()).includes("ok");
    return {
      running: healthy,
      healthy,
      engine: "llama",
      model: cfg.embed_model,
      base_url: base,
      pid: null,
      message: healthy ? "Embeddings ready (dev)" : "No embedding engine on loopback",
    };
  } catch {
    return {
      running: false,
      healthy: false,
      engine: null,
      model: null,
      base_url: base,
      pid: null,
      message: "No embedding engine reachable",
    };
  }
}

// ---------------------------------------------------------------------------
// Vector index (sqlite-vec in the app; in-memory cosine in browser dev)
// ---------------------------------------------------------------------------

function l2normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  return n > 0 ? v.map((x) => x / n) : v.slice();
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

const devIndex: { embedding: number[]; meta: Chunk }[] = [];

async function devEmbedBatch(texts: string[]): Promise<number[][]> {
  const cfg = devConfig();
  const url = `http://${cfg.host}:${cfg.embed_port}/v1/embeddings`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", input: texts }),
  });
  if (!r.ok) throw new Error(`Embedding engine returned ${r.status}`);
  const json = await r.json();
  return (json.data ?? []).map((d: { embedding: number[] }) => d.embedding);
}

export async function indexStatus(): Promise<IndexStatus> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<IndexStatus>("index_status");
  }
  return {
    indexed: devIndex.length > 0,
    count: devIndex.length,
    dim: devIndex[0]?.embedding.length ?? null,
  };
}

export async function buildIndex(chunks: Chunk[]): Promise<IndexStatus> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<IndexStatus>("build_index", { chunks });
  }
  // Dev: embed each chunk (prefixed for nomic) and keep an in-memory index.
  devIndex.length = 0;
  for (let i = 0; i < chunks.length; i += 16) {
    const batch = chunks.slice(i, i + 16);
    const embs = await devEmbedBatch(batch.map((c) => `search_document: ${c.text}`));
    batch.forEach((c, j) => {
      if (embs[j]) devIndex.push({ embedding: l2normalize(embs[j]), meta: c });
    });
  }
  return {
    indexed: devIndex.length > 0,
    count: devIndex.length,
    dim: devIndex[0]?.embedding.length ?? null,
  };
}

export async function vectorSearch(
  query: string,
  k: number,
  kind?: string,
): Promise<Hit[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Hit[]>("vector_search", { query, k, kind: kind ?? null });
  }
  // Dev: embed the query, cosine over the in-memory index.
  const [q] = await devEmbedBatch([`search_query: ${query}`]);
  if (!q) return [];
  const qn = l2normalize(q);
  const scored = devIndex
    .map((e, id) => ({ id, sim: dot(qn, e.embedding), e }))
    .filter((x) => (kind ? x.e.meta.kind === kind : true))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k);
  return scored.map((x) => ({
    id: x.id,
    path: x.e.meta.path ?? "",
    kind: x.e.meta.kind,
    line_start: x.e.meta.line_start,
    conv_id: x.e.meta.conv_id ?? "",
    distance: 1 - x.sim,
    similarity: Math.max(0, Math.min(1, x.sim)),
  }));
}

export { DEV_BASE_URL };
