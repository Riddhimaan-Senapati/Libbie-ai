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
  // vLLM (Linux + NVIDIA)
  vllm_model: string | null;
  vllm_gpu_mem_util: number;
  vllm_max_model_len: number | null;
  vllm_quantization: string | null;
  vllm_dtype: string;
  // cloud providers (used only when offline_mode is off)
  chat_provider: "local" | "openai_compatible" | "anthropic";
  openai_base_url: string;
  openai_api_key: string | null;
  openai_model: string;
  openai_embed_model: string;
  anthropic_base_url: string;
  anthropic_api_key: string | null;
  anthropic_model: string;
  // GitHub integration (OAuth device flow)
  github_token: string | null;
  github_client_id: string;
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

/** Per-call token accounting (mirrors Rust `StreamEvent::Usage`). */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  tokensPerSec: number | null;
}

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; tokensPerSec: number | null }
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

/** Lazy-import the Tauri IPC bridge and invoke a command (app runtime only). */
async function ipc<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

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
    vllm_model: null,
    vllm_gpu_mem_util: 0.9,
    vllm_max_model_len: null,
    vllm_quantization: null,
    vllm_dtype: "auto",
    chat_provider: "local",
    openai_base_url: "https://api.openai.com/v1",
    openai_api_key: null,
    openai_model: "gpt-4o-mini",
    openai_embed_model: "text-embedding-3-small",
    anthropic_base_url: "https://api.anthropic.com",
    anthropic_api_key: null,
    anthropic_model: "claude-sonnet-5",
    github_token: null,
    github_client_id: "",
  };
  return stored ? { ...base, ...JSON.parse(stored) } : base;
}

export async function getConfig(): Promise<AppConfig> {
  if (isTauri()) return ipc<AppConfig>("get_config");
  return devConfig();
}

export async function setConfig(config: AppConfig): Promise<AppConfig> {
  if (isTauri()) return ipc<AppConfig>("set_config", { config });
  localStorage.setItem(DEV_CONFIG_KEY, JSON.stringify(config));
  return config;
}

// ---------------------------------------------------------------------------
// Hardware / engine
// ---------------------------------------------------------------------------

export async function getHardware(): Promise<HardwareInfo> {
  if (isTauri()) return ipc<HardwareInfo>("get_hardware");
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
  if (isTauri()) return ipc<EngineChoice>("get_engine_choice");
  return { engine: "llama", reason: "Browser dev: external llama-server." };
}

/**
 * Dev-only: probe a loopback engine's `/health` and report an `EngineStatus`.
 * Used by both the chat and embedding engine status fallbacks.
 */
async function devEngineStatus(
  port: number,
  model: string | null,
  msg: { ready: string; down: string; unreachable: string },
): Promise<EngineStatus> {
  const cfg = devConfig();
  const base = `http://${cfg.host}:${port}`;
  try {
    const r = await fetch(`${base}/health`);
    const healthy = r.ok && (await r.text()).includes("ok");
    return {
      running: healthy,
      healthy,
      engine: "llama",
      model,
      base_url: base,
      pid: null,
      message: healthy ? msg.ready : msg.down,
    };
  } catch {
    return {
      running: false,
      healthy: false,
      engine: null,
      model: null,
      base_url: base,
      pid: null,
      message: msg.unreachable,
    };
  }
}

export async function engineStatus(): Promise<EngineStatus> {
  if (isTauri()) return ipc<EngineStatus>("engine_status");
  // Dev: probe the external server's health directly.
  const cfg = devConfig();
  return devEngineStatus(cfg.chat_port, cfg.chat_model, {
    ready: "External llama-server ready (dev)",
    down: "No engine on loopback",
    unreachable: "No engine reachable on loopback",
  });
}

export async function startEngine(): Promise<EngineStatus> {
  if (isTauri()) return ipc<EngineStatus>("start_engine");
  // Dev: the server is managed outside the browser; just report status.
  return engineStatus();
}

export async function stopEngine(): Promise<void> {
  if (isTauri()) await ipc<void>("stop_engine");
}

export async function listModels(): Promise<ModelEntry[]> {
  if (isTauri()) return ipc<ModelEntry[]>("list_models");
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
  onUsage?: (usage: Usage) => void;
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
      else if (evt.type === "usage")
        handlers.onUsage?.({
          inputTokens: evt.inputTokens,
          outputTokens: evt.outputTokens,
          tokensPerSec: evt.tokensPerSec,
        });
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
        stream_options: { include_usage: true },
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
  // Usage accounting: provider `usage` wins; llama.cpp `timings` is the fallback
  // for counts and the only source of tokens/sec; char/4 is the last resort.
  let usageIn: number | null = null;
  let usageOut: number | null = null;
  let timingsIn: number | null = null;
  let timingsOut: number | null = null;
  let tokensPerSec: number | null = null;
  let streamedChars = 0;
  const estTokens = (chars: number) => Math.ceil(chars / 4);
  const emitUsage = () => {
    const inputTokens =
      usageIn ??
      timingsIn ??
      estTokens(messages.reduce((n, m) => n + m.content.length, 0));
    const outputTokens = usageOut ?? timingsOut ?? estTokens(streamedChars);
    handlers.onUsage?.({ inputTokens, outputTokens, tokensPerSec });
  };
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
        emitUsage();
        handlers.onDone(finish);
        return;
      }
      if (!data) continue;
      try {
        const json = JSON.parse(data);
        if (json.usage) {
          if (typeof json.usage.prompt_tokens === "number") usageIn = json.usage.prompt_tokens;
          if (typeof json.usage.completion_tokens === "number")
            usageOut = json.usage.completion_tokens;
        }
        if (json.timings) {
          if (typeof json.timings.predicted_per_second === "number")
            tokensPerSec = json.timings.predicted_per_second;
          if (typeof json.timings.prompt_n === "number") timingsIn = json.timings.prompt_n;
          if (typeof json.timings.predicted_n === "number") timingsOut = json.timings.predicted_n;
        }
        const choice = json.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const text = choice?.delta?.content;
        if (text) {
          streamedChars += text.length;
          handlers.onToken(text);
        }
      } catch {
        /* ignore keep-alive lines */
      }
    }
  }
  emitUsage();
  handlers.onDone(finish);
}

// ---------------------------------------------------------------------------
// Embeddings (RAG index) — optional; requires an embedding engine.
// ---------------------------------------------------------------------------

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  if (isTauri()) return ipc<number[][]>("embed_texts", { inputs });
  return devEmbedBatch(inputs);
}

// ---------------------------------------------------------------------------
// Embedding engine lifecycle
// ---------------------------------------------------------------------------

export async function startEmbedEngine(): Promise<EngineStatus> {
  if (isTauri()) return ipc<EngineStatus>("start_embed_engine");
  return embedEngineStatus();
}

export async function stopEmbedEngine(): Promise<void> {
  if (isTauri()) await ipc<void>("stop_embed_engine");
}

export async function embedEngineStatus(): Promise<EngineStatus> {
  if (isTauri()) return ipc<EngineStatus>("embed_engine_status");
  const cfg = devConfig();
  return devEngineStatus(cfg.embed_port, cfg.embed_model, {
    ready: "Embeddings ready (dev)",
    down: "No embedding engine on loopback",
    unreachable: "No embedding engine reachable",
  });
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
  if (isTauri()) return ipc<IndexStatus>("index_status");
  return {
    indexed: devIndex.length > 0,
    count: devIndex.length,
    dim: devIndex[0]?.embedding.length ?? null,
  };
}

export async function buildIndex(chunks: Chunk[]): Promise<IndexStatus> {
  if (isTauri()) return ipc<IndexStatus>("build_index", { chunks });
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
  if (isTauri()) return ipc<Hit[]>("vector_search", { query, k, kind: kind ?? null });
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

// ---------------------------------------------------------------------------
// HuggingFace model download
// ---------------------------------------------------------------------------

export interface HfFile {
  path: string;
  size_mb: number;
}

export type DownloadEvent =
  | { type: "progress"; downloaded: number; total: number; fraction: number }
  | { type: "done"; path: string }
  | { type: "error"; message: string };

export interface DownloadHandlers {
  onProgress: (downloaded: number, total: number, fraction: number) => void;
  onDone: (path: string) => void;
  onError: (message: string) => void;
}

/** List the .gguf files available in a HuggingFace repo. */
export async function listHfGguf(
  repo: string,
  revision?: string,
  token?: string,
): Promise<HfFile[]> {
  if (isTauri()) {
    return ipc<HfFile[]>("list_hf_gguf", {
      repo,
      revision: revision ?? null,
      token: token ?? null,
    });
  }
  // Browser dev: hit the public HF tree API directly (may be CORS-limited).
  const rev = revision ?? "main";
  const r = await fetch(
    `https://huggingface.co/api/models/${repo}/tree/${rev}?recursive=true`,
    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  );
  if (!r.ok) throw new Error(`HuggingFace returned ${r.status}`);
  const items = (await r.json()) as Array<{ type: string; path: string; size?: number }>;
  return items
    .filter((it) => it.type === "file" && it.path.toLowerCase().endsWith(".gguf"))
    .map((it) => ({ path: it.path, size_mb: Math.round((it.size ?? 0) / 1024 / 1024) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Stream-download a GGUF into the models directory (desktop app only). */
export async function downloadModel(
  repo: string,
  filename: string,
  handlers: DownloadHandlers,
  revision?: string,
  token?: string,
): Promise<void> {
  if (!isTauri()) {
    handlers.onError("Model downloads are only available in the desktop app.");
    return;
  }
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<DownloadEvent>();
  channel.onmessage = (evt) => {
    if (evt.type === "progress") handlers.onProgress(evt.downloaded, evt.total, evt.fraction);
    else if (evt.type === "done") handlers.onDone(evt.path);
    else if (evt.type === "error") handlers.onError(evt.message);
  };
  await invoke("download_model", {
    repo,
    filename,
    revision: revision ?? null,
    token: token ?? null,
    onProgress: channel,
  });
}

// ---------------------------------------------------------------------------
// GitHub integration (OAuth device flow + repo indexing)
// ---------------------------------------------------------------------------

/** A repository the connected account can access (mirrors Rust `Repo`). */
export interface Repo {
  full_name: string;
  private: boolean;
  description: string | null;
  default_branch: string | null;
}

export type GithubLoginEvent =
  | { type: "code"; userCode: string; verificationUri: string; expiresIn: number }
  | { type: "done" }
  | { type: "error"; message: string };

export interface GithubLoginHandlers {
  onCode: (userCode: string, verificationUri: string, expiresIn: number) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export type IndexEvent =
  | { type: "status"; message: string }
  | { type: "progress"; done: number; total: number; fraction: number }
  | { type: "done"; count: number }
  | { type: "error"; message: string };

export interface GithubIndexHandlers {
  onStatus: (message: string) => void;
  onProgress: (done: number, total: number, fraction: number) => void;
  onDone: (count: number) => void;
  onError: (message: string) => void;
}

/**
 * Run the GitHub OAuth device flow. Emits `onCode` with the user code + URL to
 * display, then `onDone` on success (token stored by the Rust core) or `onError`.
 * Desktop app only — the device flow and token storage live in Rust.
 */
export async function githubLogin(handlers: GithubLoginHandlers): Promise<void> {
  if (!isTauri()) {
    handlers.onError("Connecting GitHub is only available in the desktop app.");
    return;
  }
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<GithubLoginEvent>();
  channel.onmessage = (evt) => {
    if (evt.type === "code") handlers.onCode(evt.userCode, evt.verificationUri, evt.expiresIn);
    else if (evt.type === "done") handlers.onDone();
    else if (evt.type === "error") handlers.onError(evt.message);
  };
  await invoke("github_login", { onEvent: channel });
}

/** List repositories the connected GitHub account can access. */
export async function githubListRepos(): Promise<Repo[]> {
  if (isTauri()) return ipc<Repo[]>("github_list_repos");
  throw new Error("GitHub is only available in the desktop app.");
}

/** Clone + index a repository into the RAG store (desktop app only). */
export async function githubIndexRepo(
  fullName: string,
  handlers: GithubIndexHandlers,
): Promise<void> {
  if (!isTauri()) {
    handlers.onError("Indexing a repository is only available in the desktop app.");
    return;
  }
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<IndexEvent>();
  channel.onmessage = (evt) => {
    if (evt.type === "status") handlers.onStatus(evt.message);
    else if (evt.type === "progress") handlers.onProgress(evt.done, evt.total, evt.fraction);
    else if (evt.type === "done") handlers.onDone(evt.count);
    else if (evt.type === "error") handlers.onError(evt.message);
  };
  await invoke("github_index_repo", { fullName, onEvent: channel });
}

/** Placeholder the Rust core sends in place of a stored secret; sending it back
 *  verbatim means "keep the existing value". Mirrors config.rs SECRET_SENTINEL. */
export const SECRET_SENTINEL = "__libbie_saved__";

export { DEV_BASE_URL };
