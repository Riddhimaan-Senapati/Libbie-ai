import * as React from "react";
import {
  ArrowLeft,
  Cloud,
  Cpu,
  FolderOpen,
  HardDrive,
  Loader2,
  Play,
  Square,
  ShieldCheck,
  Download,
  Server,
  Database,
  Layers,
  GitBranch,
  Copy,
  Check,
  ExternalLink,
  Lock,
} from "lucide-react";

import type {
  AppConfig,
  EngineStatus,
  HardwareInfo,
  ModelEntry,
  EngineChoice,
  IndexStatus,
  HfFile,
  Repo,
} from "@/lib/tauri";
import {
  isTauri,
  listHfGguf,
  downloadModel,
  githubLogin,
  githubListRepos,
  githubIndexRepo,
  SECRET_SENTINEL,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-primary";

/** A GGUF-model dropdown that keeps the current selection visible even when it
 *  isn't in the folder listing. Shared by the chat and embedding model pickers. */
function ModelSelect({
  value,
  placeholder,
  models,
  onChange,
}: {
  value: string | null;
  placeholder: string;
  models: ModelEntry[];
  onChange: (v: string | null) => void;
}) {
  return (
    <select
      className={inputCls}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {models.map((m) => (
        <option key={m.path} value={m.name}>
          {m.name}
          {m.size_mb ? ` (${m.size_mb} MB)` : ""}
        </option>
      ))}
      {value && !models.some((m) => m.name === value) && (
        <option value={value}>{value}</option>
      )}
    </select>
  );
}

export function Settings({
  config,
  status,
  hardware,
  choice,
  models,
  busy,
  embedStatus,
  embedBusy,
  indexInfo,
  onClose,
  onSave,
  onStart,
  onStop,
  onRefreshModels,
  onStartEmbed,
  onStopEmbed,
  onBuildIndex,
  onRefreshIndex,
}: {
  config: AppConfig;
  status: EngineStatus;
  hardware: HardwareInfo | null;
  choice: EngineChoice | null;
  models: ModelEntry[];
  busy: boolean;
  embedStatus: EngineStatus;
  embedBusy: boolean;
  indexInfo: IndexStatus;
  onClose: () => void;
  onSave: (cfg: AppConfig) => Promise<void> | void;
  onStart: () => void;
  onStop: () => void;
  onRefreshModels: () => void;
  onStartEmbed: () => Promise<EngineStatus | null> | void;
  onStopEmbed: () => void;
  onBuildIndex: () => Promise<IndexStatus>;
  onRefreshIndex?: () => void;
}) {
  const [draft, setDraft] = React.useState<AppConfig>(config);
  const [saved, setSaved] = React.useState(false);
  const [indexing, setIndexing] = React.useState(false);
  const [indexError, setIndexError] = React.useState<string | null>(null);

  // HuggingFace model download
  const [hfRepo, setHfRepo] = React.useState("");
  const [hfToken, setHfToken] = React.useState("");
  const [hfFiles, setHfFiles] = React.useState<HfFile[]>([]);
  const [hfFile, setHfFile] = React.useState("");
  const [hfListing, setHfListing] = React.useState(false);
  const [hfError, setHfError] = React.useState<string | null>(null);
  const [dl, setDl] = React.useState<{ active: boolean; fraction: number; done?: string } | null>(
    null,
  );

  // GitHub integration (OAuth device flow + repo indexing)
  const [ghConnected, setGhConnected] = React.useState(!!config.github_token);
  const [ghConnecting, setGhConnecting] = React.useState(false);
  const [ghCode, setGhCode] = React.useState<{ userCode: string; url: string } | null>(null);
  const [ghCopied, setGhCopied] = React.useState(false);
  const [ghError, setGhError] = React.useState<string | null>(null);
  const [ghRepos, setGhRepos] = React.useState<Repo[]>([]);
  const [ghReposLoading, setGhReposLoading] = React.useState(false);
  const [ghFilter, setGhFilter] = React.useState("");
  const [ghSelected, setGhSelected] = React.useState("");
  const [ghIndex, setGhIndex] = React.useState<{
    active: boolean;
    message: string;
    fraction: number;
    count?: number;
  } | null>(null);

  const cloudSelected = draft.chat_provider !== "local";

  React.useEffect(() => setDraft(config), [config]);
  React.useEffect(() => {
    if (config.github_token) setGhConnected(true);
  }, [config.github_token]);

  const ghFiltered = React.useMemo(() => {
    const q = ghFilter.trim().toLowerCase();
    const list = q
      ? ghRepos.filter(
          (r) =>
            r.full_name.toLowerCase().includes(q) ||
            (r.description ?? "").toLowerCase().includes(q),
        )
      : ghRepos;
    return list.slice(0, 300);
  }, [ghRepos, ghFilter]);

  const ghLoadRepos = React.useCallback(async () => {
    setGhError(null);
    setGhReposLoading(true);
    try {
      const repos = await githubListRepos();
      repos.sort((a, b) => a.full_name.localeCompare(b.full_name));
      setGhRepos(repos);
      setGhSelected((s) => s || repos[0]?.full_name || "");
      if (repos.length === 0) setGhError("No repositories were returned for this account.");
    } catch (e) {
      setGhError(String(e));
    } finally {
      setGhReposLoading(false);
    }
  }, []);

  const ghConnect = async () => {
    setGhError(null);
    setGhCode(null);
    setGhConnecting(true);
    await githubLogin({
      onCode: (userCode, verificationUri) => setGhCode({ userCode, url: verificationUri }),
      onDone: async () => {
        setGhConnecting(false);
        setGhCode(null);
        setGhConnected(true);
        await ghLoadRepos();
      },
      onError: (message) => {
        setGhError(message);
        setGhConnecting(false);
        setGhCode(null);
      },
    });
  };

  const copyCode = async () => {
    if (!ghCode) return;
    try {
      await navigator.clipboard.writeText(ghCode.userCode);
      setGhCopied(true);
      setTimeout(() => setGhCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const ghIndexSelected = async () => {
    setGhError(null);
    if (!ghSelected) {
      setGhError("Pick a repository to index.");
      return;
    }
    // Repo indexing embeds locally; make sure the embedding engine is up.
    if (!embedStatus.healthy) {
      const res = await onStartEmbed();
      if (res && typeof res === "object" && !res.healthy) {
        setGhError(
          "The embedding engine isn't ready. Pick an embedding GGUF model above, start it, then index.",
        );
        return;
      }
    }
    setGhIndex({ active: true, message: "Starting…", fraction: 0 });
    await githubIndexRepo(ghSelected, {
      onStatus: (message) => setGhIndex((s) => ({ active: true, message, fraction: s?.fraction ?? 0 })),
      onProgress: (_done, _total, fraction) =>
        setGhIndex({ active: true, message: "Embedding repository…", fraction }),
      onDone: (count) => {
        setGhIndex({ active: false, message: `Indexed ${count} chunks.`, fraction: 1, count });
        onRefreshIndex?.();
      },
      onError: (message) => {
        setGhError(message);
        setGhIndex(null);
      },
    });
  };

  const listHf = async () => {
    setHfError(null);
    setHfFiles([]);
    setHfFile("");
    if (!hfRepo.trim()) {
      setHfError("Enter a HuggingFace repo, e.g. Qwen/Qwen2.5-0.5B-Instruct-GGUF");
      return;
    }
    setHfListing(true);
    try {
      const files = await listHfGguf(hfRepo.trim(), undefined, hfToken || undefined);
      setHfFiles(files);
      if (files[0]) setHfFile(files[0].path);
      if (files.length === 0) setHfError("No .gguf files found in that repo.");
    } catch (e) {
      setHfError(String(e));
    } finally {
      setHfListing(false);
    }
  };

  const download = async () => {
    setHfError(null);
    if (!hfFile) {
      setHfError("Pick a .gguf file to download.");
      return;
    }
    setDl({ active: true, fraction: 0 });
    await downloadModel(
      hfRepo.trim(),
      hfFile,
      {
        onProgress: (_d, _t, fraction) => setDl({ active: true, fraction }),
        onDone: (path) => {
          setDl({ active: false, fraction: 1, done: path });
          onRefreshModels();
        },
        onError: (message) => {
          setHfError(message);
          setDl(null);
        },
      },
      undefined,
      hfToken || undefined,
    );
  };

  const set = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    await onSave(draft);
    setSaved(true);
  };

  const build = async () => {
    setIndexError(null);
    setIndexing(true);
    try {
      await onBuildIndex();
    } catch (e) {
      setIndexError(String(e));
    } finally {
      setIndexing(false);
    }
  };

  const browse = async (key: "llama_binary" | "models_dir", directory: boolean) => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory, multiple: false });
    if (typeof picked === "string") set(key, picked);
  };

  return (
    <div className="scroll-soft mx-auto h-full max-w-3xl overflow-y-auto px-6 py-6">
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back
        </button>
        <h1 className="text-xl font-semibold">Model &amp; engine settings</h1>
      </div>

      {/* chat provider */}
      <section className="panel mb-5 rounded-xl p-4">
        <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
          <Cloud className="size-4 text-primary" aria-hidden /> Chat provider
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider" hint="Local keeps the strict air-gap; cloud needs air-gap off.">
            <select
              className={inputCls}
              value={draft.chat_provider}
              onChange={(e) => set("chat_provider", e.target.value as AppConfig["chat_provider"])}
            >
              <option value="local">Local (llama.cpp / vLLM)</option>
              <option value="openai_compatible">OpenAI-compatible API</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </Field>
          {cloudSelected && draft.offline_mode && (
            <p className="self-end rounded-lg bg-danger/10 px-3 py-2 text-[11px] text-danger">
              Turn off “Strict air-gapped mode” below to save a cloud provider.
            </p>
          )}
        </div>

        {draft.chat_provider === "openai_compatible" && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Base URL" hint="OpenAI, Groq, Together, Mistral, OpenRouter, a local proxy…">
              <input
                className={inputCls}
                value={draft.openai_base_url}
                onChange={(e) => set("openai_base_url", e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </Field>
            <Field label="API key" hint="Kept in the Rust core; never sent back to the UI.">
              <input
                type="password"
                className={inputCls}
                value={draft.openai_api_key === SECRET_SENTINEL ? "" : (draft.openai_api_key ?? "")}
                onChange={(e) => set("openai_api_key", e.target.value || null)}
                placeholder={draft.openai_api_key === SECRET_SENTINEL ? "•••• saved. Blank keeps it." : "sk-…"}
              />
            </Field>
            <Field label="Chat model">
              <input
                className={inputCls}
                value={draft.openai_model}
                onChange={(e) => set("openai_model", e.target.value)}
                placeholder="gpt-4o-mini"
              />
            </Field>
            <Field label="Embedding model" hint="Used for cloud RAG (optional).">
              <input
                className={inputCls}
                value={draft.openai_embed_model}
                onChange={(e) => set("openai_embed_model", e.target.value)}
                placeholder="text-embedding-3-small"
              />
            </Field>
          </div>
        )}

        {draft.chat_provider === "anthropic" && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Base URL">
              <input
                className={inputCls}
                value={draft.anthropic_base_url}
                onChange={(e) => set("anthropic_base_url", e.target.value)}
                placeholder="https://api.anthropic.com"
              />
            </Field>
            <Field label="API key" hint="Kept in the Rust core; never sent back to the UI.">
              <input
                type="password"
                className={inputCls}
                value={draft.anthropic_api_key === SECRET_SENTINEL ? "" : (draft.anthropic_api_key ?? "")}
                onChange={(e) => set("anthropic_api_key", e.target.value || null)}
                placeholder={draft.anthropic_api_key === SECRET_SENTINEL ? "•••• saved. Blank keeps it." : "sk-ant-…"}
              />
            </Field>
            <Field label="Model">
              <input
                className={inputCls}
                value={draft.anthropic_model}
                onChange={(e) => set("anthropic_model", e.target.value)}
                placeholder="claude-sonnet-5"
              />
            </Field>
            <p className="self-end text-[11px] text-muted-foreground">
              Anthropic has no embeddings API, so RAG uses the local embedder or keyword fallback.
            </p>
          </div>
        )}

        {draft.chat_provider === "local" && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Configure the local engine, model, and embeddings below. Nothing leaves the machine.
          </p>
        )}
      </section>

      {/* hardware + engine choice */}
      <section className="panel mb-5 rounded-xl p-4">
        <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
          <Cpu className="size-4 text-primary" aria-hidden /> This machine
        </h2>
        {hardware ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px] sm:grid-cols-3">
            <Info label="OS / arch" value={`${hardware.os} · ${hardware.arch}`} />
            <Info label="CPU threads" value={String(hardware.cpu_count)} />
            <Info
              label="Memory"
              value={hardware.total_mem_mb ? `${Math.round(hardware.total_mem_mb / 1024)} GB` : "—"}
            />
            <Info label="NVIDIA GPU" value={hardware.has_nvidia ? "yes" : "no"} />
            <Info
              label="GPU"
              value={hardware.gpu_names[0] ?? "—"}
            />
            <Info label="llama.cpp backend" value={hardware.llama_backend} />
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">Detecting…</p>
        )}
        {choice && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-primary/5 px-3 py-2 text-[12px] text-foreground">
            <Server className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="font-semibold uppercase">{choice.engine}</span>: {choice.reason}
            </span>
          </p>
        )}
      </section>

      {/* engine control */}
      <section className="panel mb-5 rounded-xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            <HardDrive className="size-4 text-primary" aria-hidden /> Engine
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{status.message}</span>
            {status.healthy ? (
              <button
                type="button"
                onClick={onStop}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[12px] font-medium text-foreground disabled:opacity-40"
              >
                <Square className="size-3.5" aria-hidden /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={onStart}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Play className="size-3.5" aria-hidden />
                )}
                Start engine
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="llama-server binary" hint="Auto-detected when possible.">
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={draft.llama_binary ?? ""}
                onChange={(e) => set("llama_binary", e.target.value || null)}
                placeholder="path to llama-server(.exe)"
              />
              {isTauri() && (
                <button
                  type="button"
                  onClick={() => browse("llama_binary", false)}
                  className="shrink-0 rounded-lg border border-border px-2.5 text-muted-foreground hover:text-foreground"
                  aria-label="Browse for binary"
                >
                  <FolderOpen className="size-4" aria-hidden />
                </button>
              )}
            </div>
          </Field>

          <Field label="Models directory" hint="Where pre-staged GGUF models live.">
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={draft.models_dir}
                onChange={(e) => set("models_dir", e.target.value)}
              />
              {isTauri() && (
                <button
                  type="button"
                  onClick={() => browse("models_dir", true)}
                  className="shrink-0 rounded-lg border border-border px-2.5 text-muted-foreground hover:text-foreground"
                  aria-label="Browse for folder"
                >
                  <FolderOpen className="size-4" aria-hidden />
                </button>
              )}
            </div>
          </Field>

          <Field label="Chat model (GGUF)">
            <div className="flex gap-2">
              <ModelSelect
                value={draft.chat_model}
                placeholder="— select a model —"
                models={models}
                onChange={(v) => set("chat_model", v)}
              />
              <button
                type="button"
                onClick={onRefreshModels}
                className="shrink-0 rounded-lg border border-border px-2.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Refresh
              </button>
            </div>
          </Field>

          <Field label="Preferred engine">
            <select
              className={inputCls}
              value={draft.preferred_engine}
              onChange={(e) =>
                set("preferred_engine", e.target.value as AppConfig["preferred_engine"])
              }
            >
              <option value="auto">Auto (detect hardware)</option>
              <option value="llama">llama.cpp (GGUF)</option>
              <option value="vllm">vLLM (Linux + NVIDIA)</option>
            </select>
          </Field>

          <Field label="Context size" hint="Tokens of context window.">
            <input
              type="number"
              className={inputCls}
              value={draft.ctx_size}
              onChange={(e) => set("ctx_size", Number(e.target.value) || 4096)}
            />
          </Field>

          <Field label="GPU layers (-ngl)" hint="-1 = offload as many as fit.">
            <input
              type="number"
              className={inputCls}
              value={draft.gpu_layers}
              onChange={(e) => set("gpu_layers", Number(e.target.value))}
            />
          </Field>

          <Field label="Chat port">
            <input
              type="number"
              className={inputCls}
              value={draft.chat_port}
              onChange={(e) => set("chat_port", Number(e.target.value) || 51820)}
            />
          </Field>

          <Field label="Embeddings port" hint="Second llama-server for /v1/embeddings.">
            <input
              type="number"
              className={inputCls}
              value={draft.embed_port}
              onChange={(e) => set("embed_port", Number(e.target.value) || 51821)}
            />
          </Field>
        </div>
      </section>

      {/* vLLM (Linux + NVIDIA) */}
      <section className="panel mb-5 rounded-xl p-4">
        <h2 className="mb-1 flex items-center gap-2 text-[13px] font-semibold">
          <Server className="size-4 text-primary" aria-hidden /> vLLM engine (Linux + NVIDIA)
        </h2>
        <p className="mb-3 text-[12px] text-muted-foreground">
          Used automatically when this host is Linux with an NVIDIA GPU and a{" "}
          <span className="font-mono">vllm</span> binary is set (or when the engine is forced to
          vLLM). It uses the same OpenAI-compatible contract as llama.cpp, so the client is
          unchanged. vLLM loads HuggingFace weights, not GGUF.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="vLLM binary" hint="Path to `vllm` (defaults to `vllm` on PATH).">
            <input
              className={inputCls}
              value={draft.vllm_binary ?? ""}
              onChange={(e) => set("vllm_binary", e.target.value || null)}
              placeholder="vllm"
            />
          </Field>
          <Field label="vLLM model" hint="HuggingFace repo id or local model dir.">
            <input
              className={inputCls}
              value={draft.vllm_model ?? ""}
              onChange={(e) => set("vllm_model", e.target.value || null)}
              placeholder="Qwen/Qwen2.5-7B-Instruct"
            />
          </Field>
          <Field label="GPU memory utilization" hint="0–1 fraction of VRAM.">
            <input
              type="number"
              step="0.05"
              min="0.1"
              max="1"
              className={inputCls}
              value={draft.vllm_gpu_mem_util}
              onChange={(e) => set("vllm_gpu_mem_util", Number(e.target.value) || 0.9)}
            />
          </Field>
          <Field label="Max model length" hint="Blank = model default.">
            <input
              type="number"
              className={inputCls}
              value={draft.vllm_max_model_len ?? ""}
              onChange={(e) =>
                set("vllm_max_model_len", e.target.value ? Number(e.target.value) : null)
              }
              placeholder="auto"
            />
          </Field>
          <Field label="Quantization">
            <select
              className={inputCls}
              value={draft.vllm_quantization ?? ""}
              onChange={(e) => set("vllm_quantization", e.target.value || null)}
            >
              <option value="">none</option>
              <option value="awq">awq</option>
              <option value="gptq">gptq</option>
              <option value="fp8">fp8</option>
              <option value="bitsandbytes">bitsandbytes</option>
            </select>
          </Field>
          <Field label="dtype">
            <select
              className={inputCls}
              value={draft.vllm_dtype}
              onChange={(e) => set("vllm_dtype", e.target.value)}
            >
              <option value="auto">auto</option>
              <option value="bfloat16">bfloat16</option>
              <option value="float16">float16</option>
              <option value="half">half</option>
              <option value="float32">float32</option>
            </select>
          </Field>
        </div>
      </section>

      {/* air-gap */}
      <section className="panel mb-5 rounded-xl p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={draft.offline_mode}
            onChange={(e) => set("offline_mode", e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--primary)]"
          />
          <span>
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <ShieldCheck className="size-4 text-ok" aria-hidden /> Strict air-gapped mode
            </span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              The Rust core refuses any request whose destination isn't loopback (127.0.0.1).
              Models must be pre-staged; there is zero outbound network at runtime.
            </span>
          </span>
        </label>
      </section>

      {/* embeddings + vector index */}
      <section className="panel mb-5 rounded-xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            <Database className="size-4 text-primary" aria-hidden /> Embeddings &amp; vector index
          </h2>
          <span className="text-[11px] text-muted-foreground">{embedStatus.message}</span>
        </div>
        <p className="mb-3 text-[12px] text-muted-foreground">
          Semantic retrieval uses a local GGUF embedding model (served by a second
          <span className="font-mono"> llama-server</span>) and an on-disk{" "}
          <span className="font-mono">sqlite-vec</span> index that is statically linked and needs
          no daemon, so it stays offline. Without an index, Libbie falls back to keyword retrieval.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Embedding model (GGUF)" hint="e.g. nomic-embed-text (768-dim).">
            <ModelSelect
              value={draft.embed_model}
              placeholder="— select an embedding model —"
              models={models}
              onChange={(v) => set("embed_model", v)}
            />
          </Field>

          <div className="flex items-end gap-2">
            {embedStatus.healthy ? (
              <button
                type="button"
                onClick={onStopEmbed}
                disabled={embedBusy}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-2 text-[12px] font-medium text-foreground disabled:opacity-40"
              >
                <Square className="size-3.5" aria-hidden /> Stop embeddings
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartEmbed}
                disabled={embedBusy}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-3 py-2 text-[12px] font-medium text-primary disabled:opacity-40"
              >
                {embedBusy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Play className="size-3.5" aria-hidden />
                )}
                Start embeddings
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
          <Layers className="size-4 text-primary" aria-hidden />
          <span className="text-[12px] text-foreground">
            {indexInfo.indexed ? (
              <>
                Index built ·{" "}
                <span className="font-mono">{indexInfo.count}</span> chunks
                {indexInfo.dim ? (
                  <>
                    {" "}
                    · <span className="font-mono">{indexInfo.dim}</span>-dim
                  </>
                ) : null}
              </>
            ) : (
              "No vector index yet. Keyword retrieval is active."
            )}
          </span>
          <button
            type="button"
            onClick={build}
            disabled={indexing || embedBusy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {indexing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Database className="size-3.5" aria-hidden />
            )}
            {indexing ? "Embedding corpus…" : indexInfo.indexed ? "Rebuild index" : "Build index"}
          </button>
        </div>
        {indexError && (
          <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[11px] text-danger">
            {indexError}
          </p>
        )}
      </section>

      {/* download models from HuggingFace */}
      <section className="panel mb-5 rounded-xl p-4">
        <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
          <Download className="size-4 text-primary" aria-hidden /> Download a model from HuggingFace
        </h2>
        {draft.offline_mode ? (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
            Downloads are disabled in strict air-gapped mode. Turn off air-gap above to download,
            or stage a <span className="font-mono">.gguf</span> into{" "}
            <span className="font-mono">{draft.models_dir}</span> manually
            (e.g. <span className="font-mono">hf download owner/repo-GGUF file.gguf --local-dir …</span>).
          </p>
        ) : (
          <>
            <p className="mb-3 text-[12px] text-muted-foreground">
              Enter a GGUF repo, list its files, and download straight into your models folder.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="HuggingFace repo" hint="e.g. Qwen/Qwen2.5-0.5B-Instruct-GGUF">
                <div className="flex gap-2">
                  <input
                    className={inputCls}
                    value={hfRepo}
                    onChange={(e) => setHfRepo(e.target.value)}
                    placeholder="owner/repo-GGUF"
                  />
                  <button
                    type="button"
                    onClick={listHf}
                    disabled={hfListing}
                    className="shrink-0 rounded-lg border border-border px-2.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    {hfListing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "List"}
                  </button>
                </div>
              </Field>
              <Field label="Token (optional)" hint="Only for gated/private repos.">
                <input
                  type="password"
                  className={inputCls}
                  value={hfToken}
                  onChange={(e) => setHfToken(e.target.value)}
                  placeholder="hf_…"
                />
              </Field>
            </div>

            {hfFiles.length > 0 && (
              <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label="GGUF file">
                  <select
                    className={inputCls}
                    value={hfFile}
                    onChange={(e) => setHfFile(e.target.value)}
                  >
                    {hfFiles.map((f) => (
                      <option key={f.path} value={f.path}>
                        {f.path}
                        {f.size_mb ? ` (${f.size_mb} MB)` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  type="button"
                  onClick={download}
                  disabled={dl?.active}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
                >
                  {dl?.active ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Download className="size-3.5" aria-hidden />
                  )}
                  Download
                </button>
              </div>
            )}

            {dl?.active && (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${Math.round(dl.fraction * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Downloading… {Math.round(dl.fraction * 100)}%
                </p>
              </div>
            )}
            {dl?.done && (
              <p className="mt-2 rounded-lg bg-ok/10 px-3 py-2 text-[11px] text-ok">
                Downloaded to <span className="font-mono">{dl.done}</span>. Pick it in the chat/
                embedding model dropdown above.
              </p>
            )}
          </>
        )}
        {hfError && (
          <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[11px] text-danger">{hfError}</p>
        )}
      </section>

      {/* GitHub: connect an account and index a repo into the RAG store */}
      <section className="panel mb-5 rounded-xl p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            <GitBranch className="size-4 text-primary" aria-hidden /> Connect GitHub &amp; index a repo
          </h2>
          {ghConnected && (
            <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[10.5px] font-medium text-ok">
              <Check className="size-3" aria-hidden /> Connected
            </span>
          )}
        </div>

        {draft.offline_mode ? (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
            GitHub access is disabled in strict air-gapped mode. Turn off air-gap above to connect
            your account and index a repository.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[12px] text-muted-foreground">
              Authorize via GitHub&apos;s device flow (no password leaves this app), pick any
              repository you can access (including private and org-owned), and index it into the
              local vector store to chat over it.
            </p>

            {/* Client id (operator-registered OAuth App) */}
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="OAuth App client id"
                hint="From your registered GitHub OAuth App (device flow). Or set LIBBIE_GITHUB_CLIENT_ID."
              >
                <input
                  className={inputCls}
                  value={draft.github_client_id}
                  onChange={(e) => set("github_client_id", e.target.value)}
                  placeholder="Iv1.xxxxxxxxxxxx"
                />
              </Field>
              <div className="flex items-end">
                {!ghConnected ? (
                  <button
                    type="button"
                    onClick={ghConnect}
                    disabled={ghConnecting}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {ghConnecting ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <GitBranch className="size-3.5" aria-hidden />
                    )}
                    Connect GitHub
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={ghLoadRepos}
                    disabled={ghReposLoading}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    {ghReposLoading ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : null}
                    Refresh repositories
                  </button>
                )}
              </div>
            </div>

            {/* Device-flow code prompt */}
            {ghCode && (
              <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-3">
                <p className="text-[12px] text-foreground">
                  Open{" "}
                  <a
                    href={ghCode.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary underline"
                  >
                    {ghCode.url}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>{" "}
                  and enter this code:
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="rounded-md bg-background px-3 py-1.5 font-mono text-[15px] font-semibold tracking-widest text-foreground">
                    {ghCode.userCode}
                  </code>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {ghCopied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                    {ghCopied ? "Copied" : "Copy"}
                  </button>
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" aria-hidden /> Waiting for authorization…
                  </span>
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span>
                    For orgs that enforce SAML SSO, authorize the token for that org (GitHub &rarr;
                    &ldquo;Configure SSO&rdquo;) or its private repos won&apos;t appear.
                  </span>
                </p>
              </div>
            )}

            {/* Repo picker + index */}
            {ghConnected && ghRepos.length > 0 && (
              <div className="grid gap-4">
                <Field label="Repository" hint="Search by name; private and org repos are included.">
                  <input
                    className={cn(inputCls, "mb-2")}
                    value={ghFilter}
                    onChange={(e) => setGhFilter(e.target.value)}
                    placeholder="Filter repositories…"
                  />
                  <select
                    className={inputCls}
                    size={6}
                    value={ghSelected}
                    onChange={(e) => setGhSelected(e.target.value)}
                  >
                    {ghFiltered.map((r) => (
                      <option key={r.full_name} value={r.full_name}>
                        {r.full_name}
                        {r.private ? " (private)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
                  <GitBranch className="size-4 text-primary" aria-hidden />
                  <span className="text-[12px] text-foreground">
                    {ghIndex?.count != null
                      ? `Indexed ${ghIndex.count} chunks from ${ghSelected}.`
                      : ghSelected
                        ? <>Ready to index <span className="font-mono">{ghSelected}</span>.</>
                        : "Pick a repository above."}
                  </span>
                  <button
                    type="button"
                    onClick={ghIndexSelected}
                    disabled={ghIndex?.active || !ghSelected}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {ghIndex?.active ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Database className="size-3.5" aria-hidden />
                    )}
                    Index this repo
                  </button>
                </div>

                {ghIndex?.active && (
                  <div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-[width]"
                        style={{ width: `${Math.round(ghIndex.fraction * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {ghIndex.message} {ghIndex.fraction > 0 ? `${Math.round(ghIndex.fraction * 100)}%` : ""}
                    </p>
                  </div>
                )}
                {ghIndex && !ghIndex.active && ghIndex.count != null && (
                  <p className="rounded-lg bg-ok/10 px-3 py-2 text-[11px] text-ok">
                    {ghIndex.message} Ask Libbie a question to chat over this repository.
                  </p>
                )}
              </div>
            )}
          </>
        )}
        {ghError && (
          <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[11px] text-danger">{ghError}</p>
        )}
      </section>

      <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-3 border-t border-border bg-background/90 px-6 py-3 backdrop-blur">
        {saved && <span className="text-[12px] text-ok">Saved.</span>}
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-full bg-primary px-5 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
        >
          Save settings
        </button>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("truncate font-mono text-[12px] text-foreground")} title={value}>
        {value}
      </p>
    </div>
  );
}
