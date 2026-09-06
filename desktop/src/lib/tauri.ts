// Typed bridge to the Rust core.
//
// Two runtimes are supported by the SAME UI:
//   * Tauri (production): commands are invoked over IPC; the Rust core owns the
//     engine lifecycle and proxies all inference, so the webview never hits the
//     network.
//   * Browser dev (no Tauri): the client talks directly to a local llama-server
//     over loopback, so the full experience can be developed/verified in a
//     normal browser. This path is dev-only; the shipped app always uses IPC.

import { ChatSSEParser } from "@/lib/sse";

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
  // Slack connector
  slack_token: string | null;
  slack_client_id: string;
  slack_client_secret: string | null;
  // Email: Gmail (OAuth)
  gmail_token: string | null;
  gmail_client_id: string;
  gmail_client_secret: string | null;
  // Email: IMAP (app password)
  imap_host: string;
  imap_port: number;
  imap_user: string;
  imap_password: string | null;
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

/**
 * The `kind` tag of a structured error returned by a Rust command (mirrors the
 * Rust `AppError` enum in `src-tauri/src/error.rs`). Switch on this to recover
 * programmatically — e.g. treat `vectorStoreUnavailable` as "fall back to
 * lexical retrieval" rather than surfacing a hard error.
 */
export type AppErrorKind =
  | "engineNotConfigured"
  | "modelNotSelected"
  | "modelNotFound"
  | "engineSpawnFailed"
  | "engineUnhealthy"
  | "engineUnreachable"
  | "engineError"
  | "embedding"
  | "airgapBlocked"
  | "vectorStoreUnavailable"
  | "vectorStore"
  | "config"
  | "invalidInput"
  | "github"
  | "slack"
  | "email";

/** A structured error thrown (rejected) by a Tauri command invocation. */
export interface AppError {
  kind: AppErrorKind;
  message: string;
}

/** Type guard for the structured error shape crossing the IPC boundary. */
export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
  );
}

/** Best-effort human-readable message from any thrown command error. */
export function errorMessage(e: unknown): string {
  if (isAppError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

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

export interface VectorRetrieval {
  code_hits: Hit[];
  conversation_hits: Hit[];
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
    slack_token: null,
    slack_client_id: "",
    slack_client_secret: null,
    gmail_token: null,
    gmail_client_id: "",
    gmail_client_secret: null,
    imap_host: "",
    imap_port: 993,
    imap_user: "",
    imap_password: null,
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
 * Invoke a command whose last IPC argument is a Tauri event `Channel`, and
 * dispatch each event to `onmessage`. The common plumbing behind every
 * streaming/progress command (`ask_libbie`, downloads, connector runs).
 */
async function invokeWithChannel<E>(
  cmd: string,
  args: Record<string, unknown>,
  argKey: string,
  onmessage: (evt: E) => void,
): Promise<void> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<E>();
  channel.onmessage = onmessage;
  await invoke(cmd, { ...args, [argKey]: channel });
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
    await invokeWithChannel<StreamEvent>(
      "ask_libbie",
      { messages, options },
      "onEvent",
      (evt) => {
        if (evt.type === "token") handlers.onToken(evt.text);
        else if (evt.type === "usage")
          handlers.onUsage?.({
            inputTokens: evt.inputTokens,
            outputTokens: evt.outputTokens,
            tokensPerSec: evt.tokensPerSec,
          });
        else if (evt.type === "done") handlers.onDone(evt.finishReason);
        else if (evt.type === "error") handlers.onError(evt.message);
      },
    );
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
  // Browser-dev fallback: main's shared SSE parser handles tokens/done. Real
  // token/cost accounting runs through the Tauri Channel in the shipped app
  // (see the isTauri() branch), so the dev path doesn't emit usage.
  const parser = new ChatSSEParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const evt of parser.push(decoder.decode(value, { stream: true }))) {
      if (evt.type === "token") {
        handlers.onToken(evt.text);
      } else {
        handlers.onDone(evt.finishReason);
        return;
      }
    }
  }
  for (const evt of parser.end()) {
    if (evt.type === "done") handlers.onDone(evt.finishReason);
  }
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

/** Dev-mode KNN: cosine over the in-memory index, filtered + top-k. */
function devKnn(qn: number[], kind: string | undefined, k: number): Hit[] {
  return devIndex
    .map((e, id) => ({ id, sim: dot(qn, e.embedding), e }))
    .filter((x) => (kind ? x.e.meta.kind === kind : true))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k)
    .map((x) => ({
      id: x.id,
      path: x.e.meta.path ?? "",
      kind: x.e.meta.kind,
      line_start: x.e.meta.line_start,
      conv_id: x.e.meta.conv_id ?? "",
      distance: 1 - x.sim,
      similarity: Math.max(0, Math.min(1, x.sim)),
    }));
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
  return devKnn(l2normalize(q), kind, k);
}

/** Embed a semantic query once and retrieve both citation kinds. */
export async function retrieveVector(
  query: string,
  codeK: number,
  conversationK: number,
): Promise<VectorRetrieval> {
  if (isTauri()) {
    return ipc<VectorRetrieval>("retrieve_vector", {
      query,
      codeK,
      conversationK,
    });
  }
  // Dev mode keeps the same one-embedding contract as the desktop command.
  const [q] = await devEmbedBatch([`search_query: ${query}`]);
  if (!q) return { code_hits: [], conversation_hits: [] };
  const qn = l2normalize(q);
  return {
    code_hits: devKnn(qn, "code", codeK),
    conversation_hits: devKnn(qn, "conversation", conversationK),
  };
}

// ---------------------------------------------------------------------------
// Provenance graph — read a `libbie join` graph.json chosen by the user
// ---------------------------------------------------------------------------

/**
 * Open a native file picker (IN the Rust core) and return the chosen graph
 * JSON's contents, or null if cancelled. The path is chosen by the user in the
 * OS dialog and never supplied by the (untrusted) webview, so this can't be
 * abused to read arbitrary files. Plain local read; works in air-gapped mode.
 */
export async function openGraphJson(): Promise<string | null> {
  if (isTauri()) return ipc<string | null>("open_graph_json");
  throw new Error("Loading a graph file is only available in the desktop app.");
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
  await invokeWithChannel<DownloadEvent>(
    "download_model",
    { repo, filename, revision: revision ?? null, token: token ?? null },
    "onProgress",
    (evt) => {
      if (evt.type === "progress") handlers.onProgress(evt.downloaded, evt.total, evt.fraction);
      else if (evt.type === "done") handlers.onDone(evt.path);
      else if (evt.type === "error") handlers.onError(evt.message);
    },
  );
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
  await invokeWithChannel<GithubLoginEvent>(
    "github_login",
    {},
    "onEvent",
    (evt) => {
      if (evt.type === "code") handlers.onCode(evt.userCode, evt.verificationUri, evt.expiresIn);
      else if (evt.type === "done") handlers.onDone();
      else if (evt.type === "error") handlers.onError(evt.message);
    },
  );
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
  await indexViaChannel("github_index_repo", { fullName }, handlers);
}

// ---------------------------------------------------------------------------
// Slack + Email connectors (OAuth loopback / token / IMAP + message indexing)
// ---------------------------------------------------------------------------

/** A Slack conversation the token can read (mirrors Rust `SlackChannel`). */
export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_im: boolean;
}

/** A Gmail label or IMAP mailbox (mirrors Rust `EmailFolder`). */
export interface EmailFolder {
  id: string;
  name: string;
}

/** OAuth-style connect events (mirrors Rust `ConnectEvent`). */
export type ConnectEvent =
  | { type: "url"; url: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ConnectHandlers {
  /** The URL to open in the browser to authorize; the loopback catches the code. */
  onUrl: (url: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/** Progress handlers for a message-indexing run (shared shape with GitHub). */
export type IndexHandlers = GithubIndexHandlers;

function connectViaChannel(
  cmd: string,
  args: Record<string, unknown>,
  handlers: ConnectHandlers,
): Promise<void> {
  return invokeWithChannel<ConnectEvent>(cmd, args, "onEvent", (evt) => {
    if (evt.type === "url") handlers.onUrl(evt.url);
    else if (evt.type === "done") handlers.onDone();
    else if (evt.type === "error") handlers.onError(evt.message);
  });
}

function indexViaChannel(
  cmd: string,
  args: Record<string, unknown>,
  handlers: IndexHandlers,
): Promise<void> {
  return invokeWithChannel<IndexEvent>(cmd, args, "onEvent", (evt) => {
    if (evt.type === "status") handlers.onStatus(evt.message);
    else if (evt.type === "progress") handlers.onProgress(evt.done, evt.total, evt.fraction);
    else if (evt.type === "done") handlers.onDone(evt.count);
    else if (evt.type === "error") handlers.onError(evt.message);
  });
}

/**
 * Connect Slack. Pass a pasted user token to validate + store it, or omit it to
 * run the OAuth loopback flow (`onUrl` fires with the authorize URL to open).
 * Desktop app only — tokens and the loopback live in the Rust core.
 */
export async function slackConnect(
  token: string | null,
  handlers: ConnectHandlers,
): Promise<void> {
  if (!isTauri()) {
    handlers.onError("Connecting Slack is only available in the desktop app.");
    return;
  }
  await connectViaChannel("slack_connect", { token: token ?? null }, handlers);
}

/** List Slack conversations the connected account can read. */
export async function slackListChannels(): Promise<SlackChannel[]> {
  if (isTauri()) return ipc<SlackChannel[]>("slack_list_channels");
  throw new Error("Slack is only available in the desktop app.");
}

/** Index the selected Slack channels into the RAG store (desktop app only). */
export async function slackIndexChannels(
  ids: string[],
  handlers: IndexHandlers,
): Promise<void> {
  if (!isTauri()) {
    handlers.onError("Indexing Slack is only available in the desktop app.");
    return;
  }
  await indexViaChannel("slack_index_channels", { ids }, handlers);
}

/** Connect Gmail via the OAuth loopback (`onUrl` fires with the consent URL). */
export async function emailGmailConnect(handlers: ConnectHandlers): Promise<void> {
  if (!isTauri()) {
    handlers.onError("Connecting Gmail is only available in the desktop app.");
    return;
  }
  await connectViaChannel("email_gmail_connect", {}, handlers);
}

/** List Gmail labels for the connected account. */
export async function emailListLabels(): Promise<EmailFolder[]> {
  if (isTauri()) return ipc<EmailFolder[]>("email_list_labels");
  throw new Error("Gmail is only available in the desktop app.");
}

/**
 * Store IMAP credentials and verify them (returns the mailbox list on success).
 * A blank/sentinel password keeps the stored one. Desktop app only.
 */
export async function emailImapConnect(
  host: string,
  port: number,
  user: string,
  password: string | null,
): Promise<EmailFolder[]> {
  if (isTauri()) {
    return ipc<EmailFolder[]>("email_imap_connect", { host, port, user, password });
  }
  throw new Error("IMAP is only available in the desktop app.");
}

/** List mailboxes using the stored IMAP credentials. */
export async function emailListMailboxes(): Promise<EmailFolder[]> {
  if (isTauri()) return ipc<EmailFolder[]>("email_list_mailboxes");
  throw new Error("IMAP is only available in the desktop app.");
}

/**
 * Index the selected email folders into the RAG store. `source` is "gmail"
 * (labels) or "imap" (mailboxes). Desktop app only.
 */
export async function emailIndex(
  source: "gmail" | "imap",
  folders: string[],
  handlers: IndexHandlers,
): Promise<void> {
  if (!isTauri()) {
    handlers.onError("Indexing email is only available in the desktop app.");
    return;
  }
  await indexViaChannel("email_index", { source, folders }, handlers);
}

/** Placeholder the Rust core sends in place of a stored secret; sending it back
 *  verbatim means "keep the existing value". Mirrors config.rs SECRET_SENTINEL. */
export const SECRET_SENTINEL = "__libbie_saved__";

export { DEV_BASE_URL };
