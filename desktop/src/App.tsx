import * as React from "react";
import { m as motion, AnimatePresence } from "motion/react";
import {
  Command,
  Settings as SettingsIcon,
  ShieldCheck,
  PanelLeftOpen,
  Lock,
  Coins,
  Waypoints,
} from "lucide-react";

import { pipeline, getCodeFile, answers, proactiveNudge, libbie } from "@/lib/data";
import type { CodeFile, CodeRef } from "@/lib/types";
import { retrieve, retrieveVector, chunkCorpus, buildMessages, type Retrieved } from "@/lib/rag";
import { verdictStore } from "@/lib/verdictStore";
import * as api from "@/lib/tauri";
import type {
  AppConfig,
  EngineStatus,
  HardwareInfo,
  EngineChoice,
  ModelEntry,
  IndexStatus,
} from "@/lib/tauri";

const EMPTY_RETRIEVED: Retrieved = {
  code: [],
  conversations: [],
  confidence: 0,
  context: "",
  mode: "lexical",
};

const DEFAULT_ENGINE_STATUS: EngineStatus = {
  running: false,
  healthy: false,
  engine: null,
  model: null,
  base_url: null,
  pid: null,
  message: "Engine stopped",
};

/** Field-wise equality so the 4 s poll doesn't re-render the app when the
 * engine status object is identical apart from its identity. */
function sameStatus(a: EngineStatus, b: EngineStatus): boolean {
  return (
    a.running === b.running &&
    a.healthy === b.healthy &&
    a.engine === b.engine &&
    a.model === b.model &&
    a.base_url === b.base_url &&
    a.pid === b.pid &&
    a.message === b.message
  );
}

import { Logo } from "@/components/Logo";
import { ReadingIntro } from "@/components/ReadingIntro";
import { PipelineRail } from "@/components/PipelineRail";
import { CodeCanvas, refToFocus, type CanvasFocus } from "@/components/CodeCanvas";
import { LibbieRail, LibbieOrb, type AnswerSession } from "@/components/LibbieRail";
import { AskLibbie } from "@/components/AskLibbie";
import { EngineStatusPill } from "@/components/EngineStatusPill";
import { Sheet } from "@/components/Overlay";
import { RiskPanel } from "@/components/RiskPanel";
import { HandoverDoc } from "@/components/HandoverDoc";
import { TokenPanel, type CallRecord } from "@/components/TokenPanel";
import { costUsd } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const DEFAULT_FILE = "conf/params.config";

// Optional surfaces pull in connector forms and the force-graph fixture. Keep
// them out of the boot path until the user actually opens the corresponding UI.
const Settings = React.lazy(async () => {
  const module = await import("@/components/Settings");
  return { default: module.Settings };
});
const GraphView = React.lazy(async () => {
  const module = await import("@/components/GraphView");
  return { default: module.GraphView };
});
const LoadingSurface = () => <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading…</div>;

type Screen = "reading" | "workspace" | "settings" | "graph";

export default function App() {
  const [screen, setScreen] = React.useState<Screen>("reading");

  // engine + config
  const [config, setConfig] = React.useState<AppConfig | null>(null);
  const [status, setStatus] = React.useState<EngineStatus>(DEFAULT_ENGINE_STATUS);
  const [hardware, setHardware] = React.useState<HardwareInfo | null>(null);
  const [choice, setChoice] = React.useState<EngineChoice | null>(null);
  const [models, setModels] = React.useState<ModelEntry[]>([]);
  const [engineBusy, setEngineBusy] = React.useState(false);

  // embeddings + vector index
  const [embedStatus, setEmbedStatus] = React.useState<EngineStatus>(DEFAULT_ENGINE_STATUS);
  const [embedBusy, setEmbedBusy] = React.useState(false);
  const [indexInfo, setIndexInfo] = React.useState<IndexStatus>({
    indexed: false,
    count: 0,
    dim: null,
  });

  // workspace
  const [selectedPath, setSelectedPath] = React.useState(DEFAULT_FILE);
  const [focus, setFocus] = React.useState<CanvasFocus | null>(null);
  const [session, setSession] = React.useState<AnswerSession | null>(null);
  const [view, setView] = React.useState<"technical" | "executive">("technical");
  const [thinkingLine, setThinkingLine] = React.useState<string>(libbie.thinkingLines[0]);

  const [askOpen, setAskOpen] = React.useState(false);
  const [leftCollapsed, setLeftCollapsed] = React.useState(false);
  const [rightCollapsed, setRightCollapsed] = React.useState(false);
  const [riskOpen, setRiskOpen] = React.useState(false);
  const [handoverOpen, setHandoverOpen] = React.useState(false);
  const [tokensOpen, setTokensOpen] = React.useState(false);

  // Per-session token/cost ledger, appended to on every completed inference.
  const [calls, setCalls] = React.useState<CallRecord[]>([]);

  const nonce = React.useRef(0);
  const reqId = React.useRef(0);

  const selectedFile: CodeFile = getCodeFile(selectedPath) ?? pipeline.files[0];
  const usingCloud = (config?.chat_provider ?? "local") !== "local";
  const engineLabel = usingCloud
    ? config?.chat_provider === "anthropic"
      ? `Anthropic · ${config?.anthropic_model ?? ""}`
      : `Cloud · ${config?.openai_model ?? ""}`
    : hardware
      ? `${status.engine ?? "llama"} · ${hardware.llama_backend}`
      : undefined;
  // Chat is ready when a cloud provider is configured, or the local engine is healthy.
  const chatReady = usingCloud || status.healthy;

  // ---- boot -------------------------------------------------------------
  const refreshStatus = React.useCallback(async () => {
    try {
      const next = await api.engineStatus();
      setStatus((prev) => (sameStatus(prev, next) ? prev : next));
    } catch {
      /* ignore */
    }
  }, []);

  const refreshModels = React.useCallback(async () => {
    try {
      setModels(await api.listModels());
    } catch {
      /* ignore */
    }
  }, []);

  const refreshEmbed = React.useCallback(async () => {
    try {
      setEmbedStatus(await api.embedEngineStatus());
    } catch {
      /* ignore */
    }
  }, []);

  const refreshIndex = React.useCallback(async () => {
    try {
      setIndexInfo(await api.indexStatus());
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const [cfg, hw, ch] = await Promise.all([
          api.getConfig(),
          api.getHardware(),
          api.getEngineChoice(),
        ]);
        setConfig(cfg);
        setHardware(hw);
        setChoice(ch);
      } catch {
        /* ignore */
      }
      await Promise.all([refreshModels(), refreshStatus(), refreshEmbed(), refreshIndex()]);
    })();
  }, [refreshModels, refreshStatus, refreshEmbed, refreshIndex]);

  // poll engine health while in the workspace
  React.useEffect(() => {
    if (screen === "reading") return;
    const id = setInterval(refreshStatus, 4000);
    return () => clearInterval(id);
  }, [screen, refreshStatus]);  // ---- engine control ---------------------------------------------------
  const handleStart = React.useCallback(async () => {
    setEngineBusy(true);
    try {
      const s = await api.startEngine();
      setStatus(s);
      return s;
    } catch (e) {
      const msg = String(e);
      setStatus((prev) => ({ ...prev, healthy: false, message: msg }));
      return null;
    } finally {
      setEngineBusy(false);
    }
  }, []);

  const handleStop = React.useCallback(async () => {
    setEngineBusy(true);
    try {
      await api.stopEngine();
      await refreshStatus();
    } finally {
      setEngineBusy(false);
    }
  }, [refreshStatus]);

  const handleStartEmbed = React.useCallback(async (): Promise<EngineStatus | null> => {
    setEmbedBusy(true);
    try {
      const s = await api.startEmbedEngine();
      setEmbedStatus(s);
      return s;
    } catch (e) {
      const msg = String(e);
      setEmbedStatus((p) => ({ ...p, healthy: false, message: msg }));
      return null;
    } finally {
      setEmbedBusy(false);
    }
  }, []);

  const handleStopEmbed = React.useCallback(async () => {
    setEmbedBusy(true);
    try {
      await api.stopEmbedEngine();
      await refreshEmbed();
    } finally {
      setEmbedBusy(false);
    }
  }, [refreshEmbed]);

  const handleBuildIndex = React.useCallback(async (): Promise<IndexStatus> => {
    // The index build needs the embedding engine; start it if necessary.
    let es = embedStatus;
    if (!es.healthy) {
      es = (await handleStartEmbed()) ?? es;
    }
    if (!es.healthy) {
      throw new Error(
        "The embedding engine isn't ready. Select an embedding GGUF model and start it first.",
      );
    }
    const s = await api.buildIndex(chunkCorpus());
    setIndexInfo(s);
    return s;
  }, [embedStatus, handleStartEmbed]);

  const saveConfig = React.useCallback(
    async (cfg: AppConfig) => {
      const saved = await api.setConfig(cfg);
      setConfig(saved);
      try {
        setChoice(await api.getEngineChoice());
      } catch {
        /* ignore */
      }
      await refreshModels();
    },
    [refreshModels],
  );

  // ---- code focus -------------------------------------------------------
  const focusCode = React.useCallback((ref: CodeRef) => {
    if (getCodeFile(ref.path)) setSelectedPath(ref.path);
    nonce.current += 1;
    setFocus(refToFocus(ref, nonce.current));
  }, []);

  // ---- the ask / inference flow ----------------------------------------
  const runInference = React.useCallback(
    async (question: string, retrieved: Retrieved, audience: "technical" | "executive") => {
      const id = ++reqId.current;
      // Streamed text accumulates in the verdict store; App state only tracks
      // the session envelope (started/streaming), so a token never re-renders
      // the whole workspace.
      verdictStore.reset();
      setSession({
        question,
        started: false,
        streaming: true,
        retrieved,
        answeredLocally: !!config?.offline_mode,
      });
      const messages = buildMessages(question, retrieved, audience);
      await api.askLibbie(messages, { temperature: 0.2, max_tokens: 512 }, {
        onToken: (t) => {
          if (id !== reqId.current) return;
          verdictStore.append(t);
          setSession((s) => (s && !s.started ? { ...s, started: true } : s));
        },
        onUsage: (u) => {
          if (id !== reqId.current) return;
          const provider = config?.chat_provider ?? "local";
          // In browser-dev the call always hits a loopback server regardless of the
          // selected provider, so only treat it as paid cloud in the real app.
          const cloud = provider !== "local" && api.isTauri();
          const model =
            provider === "anthropic"
              ? config?.anthropic_model ?? "anthropic"
              : provider === "openai_compatible"
                ? config?.openai_model ?? "openai"
                : "local";
          setCalls((cs) => [
            ...cs,
            {
              model,
              cloud,
              inputTokens: u.inputTokens,
              outputTokens: u.outputTokens,
              tokensPerSec: u.tokensPerSec,
              costUsd: cloud ? costUsd(model, u.inputTokens, u.outputTokens) : 0,
              ts: Date.now(),
            },
          ]);
        },
        onDone: () => {
          if (id !== reqId.current) return;
          setSession((s) => (s ? { ...s, streaming: false } : s));
        },
        onError: (msg) => {
          if (id !== reqId.current) return;
          verdictStore.set(
            `I couldn't reach the model provider. ${msg}\n\nCheck Settings (engine or API key), then ask again.`,
          );
          setSession((s) => (s ? { ...s, streaming: false, started: true } : s));
        },
      });
    },
    [
      config?.offline_mode,
      config?.chat_provider,
      config?.anthropic_model,
      config?.openai_model,
    ],
  );

  const ask = React.useCallback(
    async (question: string) => {
      setRightCollapsed(false);
      setView("technical");
      setThinkingLine(
        libbie.thinkingLines[Math.floor(Math.random() * libbie.thinkingLines.length)],
      );

      // Show the thinking state immediately (before engine start + retrieval).
      setSession({
        question,
        started: false,
        streaming: true,
        retrieved: EMPTY_RETRIEVED,
        answeredLocally: !!config?.offline_mode,
      });

      // Best-effort: bring the LOCAL chat engine up if needed. A cloud provider
      // needs no local engine, so skip this gate entirely.
      if (!usingCloud && !status.healthy) {
        const s = await handleStart();
        if (!s?.healthy) {
          verdictStore.set(
            "The local engine isn't running yet. Open Settings, pick a GGUF model and press Start engine, or choose a cloud provider, then ask me again.",
          );
          setSession((cur) =>
            cur
              ? {
                  ...cur,
                  streaming: false,
                  started: true,
                }
              : cur,
          );
          return;
        }
      }

      // Prefer semantic (vector) retrieval when an index exists; the embedder
      // may be down, so fall back to lexical retrieval transparently.
      let retrieved: Retrieved | null = null;
      if (indexInfo.indexed) {
        retrieved = await retrieveVector(question);
      }
      if (!retrieved) retrieved = retrieve(question);

      if (retrieved.code[0]) focusCode(retrieved.code[0]);
      await runInference(question, retrieved, "technical");
    },
    [
      usingCloud,
      status.healthy,
      config?.offline_mode,
      indexInfo.indexed,
      focusCode,
      handleStart,
      runInference,
    ],
  );

  const onViewChange = React.useCallback(
    (v: "technical" | "executive") => {
      setView(v);
      // Re-synthesise the SAME evidence for the new audience (real inference).
      if (session && !session.streaming) {
        runInference(session.question, session.retrieved, v);
      }
    },
    [session, runInference],
  );

  const askNudge = React.useCallback(() => {
    const a = answers.find((x) => x.id === proactiveNudge.answerId);
    ask(a?.question ?? "Why was this pipeline built on GRCh37 instead of GRCh38?");
  }, [ask]);

  // ⌘K
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (screen === "workspace") setAskOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  // status line for the rail header
  const statusLine = session?.streaming
    ? session.started
      ? "Answering…"
      : thinkingLine
    : status.healthy
      ? libbie.idleStatus
      : status.message;

  // ---- render -----------------------------------------------------------
  if (screen === "reading") {
    return <ReadingIntro onDone={() => setScreen("workspace")} />;
  }

  if (screen === "settings" && config) {
    return (
      <div className="flex h-screen flex-col">
        <TopBar
          offline={!!config.offline_mode}
          status={status}
          engineBusy={engineBusy}
          onStart={handleStart}
          onStop={handleStop}
          onAsk={() => setAskOpen(true)}
          onGraph={() => setScreen("graph")}
          onSettings={() => setScreen(screen === "settings" ? "workspace" : "settings")}
          settingsActive
        />
        <main className="min-h-0 flex-1">
          <React.Suspense fallback={<LoadingSurface />}>
          <Settings
            config={config}
            status={status}
            hardware={hardware}
            choice={choice}
            models={models}
            busy={engineBusy}
            embedStatus={embedStatus}
            embedBusy={embedBusy}
            indexInfo={indexInfo}
            onClose={() => setScreen("workspace")}
            onSave={saveConfig}
            onStart={handleStart}
            onStop={handleStop}
            onRefreshModels={refreshModels}
            onStartEmbed={handleStartEmbed}
            onStopEmbed={handleStopEmbed}
            onBuildIndex={handleBuildIndex}
            onRefreshIndex={refreshIndex}
          />
          </React.Suspense>
        </main>
      </div>
    );
  }

  if (screen === "graph") {
    return (
      <div className="flex h-screen flex-col overflow-hidden">
        <TopBar
          offline={!!config?.offline_mode}
          status={status}
          engineBusy={engineBusy}
          onStart={handleStart}
          onStop={handleStop}
          onAsk={() => setAskOpen(true)}
          onTokens={() => setTokensOpen(true)}
          onGraph={() => setScreen("workspace")}
          onSettings={() => setScreen("settings")}
          graphActive
        />
        <main className="min-h-0 flex-1">
          <React.Suspense fallback={<LoadingSurface />}><GraphView /></React.Suspense>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        offline={!!config?.offline_mode}
        status={status}
        engineBusy={engineBusy}
        onStart={handleStart}
        onStop={handleStop}
        onAsk={() => setAskOpen(true)}
        onTokens={() => setTokensOpen(true)}
        onGraph={() => setScreen("graph")}
        onSettings={() => setScreen("settings")}
      />

      <div className="flex min-h-0 flex-1">
        {/* left rail */}
        <AnimatePresence initial={false}>
          {!leftCollapsed && (
            <motion.div
              key="left"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 268, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="shrink-0 overflow-hidden"
            >
              <div className="h-full w-[268px]">
                <PipelineRail
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                  onCollapse={() => setLeftCollapsed(true)}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* center canvas */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3">
          {leftCollapsed && (
            <button
              type="button"
              onClick={() => setLeftCollapsed(false)}
              className="flex w-fit items-center gap-1.5 rounded-lg border border-border bg-card/50 px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <PanelLeftOpen className="size-3.5" aria-hidden />
              Files
            </button>
          )}
          <CodeCanvas file={selectedFile} focus={focus} onLineClick={() => setAskOpen(true)} />
        </main>

        {/* right rail — Libbie */}
        <AnimatePresence initial={false}>
          {!rightCollapsed && (
            <motion.div
              key="right"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 396, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="shrink-0 overflow-hidden"
            >
              <div className="h-full w-[396px]">
                <LibbieRail
                  session={session}
                  view={view}
                  onViewChange={onViewChange}
                  statusLine={statusLine}
                  engineReady={chatReady}
                  engineLabel={engineLabel}
                  onAskNudge={askNudge}
                  onFocusCode={focusCode}
                  onCollapse={() => setRightCollapsed(true)}
                  onShowStale={() => setRiskOpen(true)}
                  onExplainForExec={() => onViewChange("executive")}
                  onDraftHandover={() => setHandoverOpen(true)}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {rightCollapsed && <LibbieOrb onClick={() => setRightCollapsed(false)} proactive={!session} />}

      <AskLibbie
        open={askOpen}
        onOpenChange={setAskOpen}
        onAsk={ask}
        disabled={!chatReady}
      />

      <Sheet open={riskOpen} onClose={() => setRiskOpen(false)} title="Libbie's watchlist">
        <RiskPanel
          onAsk={(q) => {
            setRiskOpen(false);
            ask(q);
          }}
        />
      </Sheet>

      <Sheet open={handoverOpen} onClose={() => setHandoverOpen(false)} title="Handover document" width={760}>
        <HandoverDoc />
      </Sheet>

      <Sheet open={tokensOpen} onClose={() => setTokensOpen(false)} title="Token & cost usage" width={520}>
        <TokenPanel calls={calls} />
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TopBar({
  offline,
  status,
  engineBusy,
  onStart,
  onStop,
  onAsk,
  onTokens,
  onGraph,
  onSettings,
  settingsActive,
  graphActive,
}: {
  offline: boolean;
  status: EngineStatus;
  engineBusy: boolean;
  onStart: () => void;
  onStop: () => void;
  onAsk: () => void;
  onTokens?: () => void;
  onGraph?: () => void;
  onSettings: () => void;
  settingsActive?: boolean;
  graphActive?: boolean;
}) {
  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 py-2.5 backdrop-blur"
      data-tauri-drag-region
    >
      <Logo className="h-6" />
      <span className="hidden items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
        Sample data
      </span>

      <div className="ml-auto flex items-center gap-2.5">
        {/* air-gapped indicator */}
        <span
          className={cn(
            "hidden items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium sm:inline-flex",
            offline ? "bg-ok/10 text-ok" : "bg-muted text-muted-foreground",
          )}
          title={offline ? "Strict air-gapped mode: no network egress" : "Air-gapped mode is off"}
        >
          {offline ? <ShieldCheck className="size-3" aria-hidden /> : <Lock className="size-3" aria-hidden />}
          {offline ? "Air-gapped" : "Local"}
        </span>

        <EngineStatusPill status={status} busy={engineBusy} onStart={onStart} onStop={onStop} />

        <button
          type="button"
          onClick={onAsk}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground"
        >
          <Command className="size-3.5" aria-hidden />
          Ask Libbie
          <kbd className="ml-1 hidden rounded bg-primary-foreground/20 px-1 font-mono text-[10px] sm:inline">
            ⌘K
          </kbd>
        </button>

        {onGraph && (
          <button
            type="button"
            onClick={onGraph}
            aria-label="Provenance graph"
            title="Provenance graph"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12px] transition-colors",
              graphActive
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Waypoints className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Graph</span>
          </button>
        )}

        {onTokens && (
          <button
            type="button"
            onClick={onTokens}
            aria-label="Token usage"
            title="Token & cost usage"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Coins className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Tokens</span>
          </button>
        )}

        <button
          type="button"
          onClick={onSettings}
          aria-label="Settings"
          className={cn(
            "rounded-full p-2 transition-colors",
            settingsActive
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <SettingsIcon className="size-4" aria-hidden />
        </button>
      </div>
    </header>
  );
}
