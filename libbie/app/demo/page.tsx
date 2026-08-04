"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import { Command, PanelLeftOpen, ArrowLeft, PanelLeft } from "lucide-react";

import {
  pipeline,
  answers,
  getCodeFile,
  proactiveNudge,
  freemium,
  libbie,
} from "@/lib/data";
import type { Answer, CodeFile, CodeRef } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Logo } from "@/components/Logo";
import { SampleDataBadge } from "@/components/demo/SampleDataBadge";
import { ReadingIntro } from "@/components/demo/ReadingIntro";
import { PipelineRail } from "@/components/demo/PipelineRail";
import { CodeCanvas, refToFocus, type CanvasFocus } from "@/components/demo/CodeCanvas";
import { LibbieRail, LibbieOrb } from "@/components/demo/LibbieRail";
import { AskLibbie } from "@/components/demo/AskLibbie";
import { RiskPanel } from "@/components/demo/RiskPanel";
import { HandoverDialog } from "@/components/demo/HandoverDialog";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

const DEFAULT_FILE = "conf/params.config";
const THINK_MS = 900;
const LOCAL_MS = 1200;

export default function DemoPage() {
  const [entered, setEntered] = React.useState(false);

  // global state
  const [localMode, setLocalMode] = React.useState(false);
  const [selectedPath, setSelectedPath] = React.useState(DEFAULT_FILE);
  const [focus, setFocus] = React.useState<CanvasFocus | null>(null);
  const [answer, setAnswer] = React.useState<Answer | null>(null);
  const [view, setView] = React.useState<"technical" | "executive">("technical");
  const [askOpen, setAskOpen] = React.useState(false);
  const [leftCollapsed, setLeftCollapsed] = React.useState(false);
  const [rightCollapsed, setRightCollapsed] = React.useState(false);
  const [riskOpen, setRiskOpen] = React.useState(false);
  const [pipelineSheetOpen, setPipelineSheetOpen] = React.useState(false);

  // thinking / local-mode answer flow
  const [thinking, setThinking] = React.useState(false);
  const [thinkingLine, setThinkingLine] = React.useState<string>(
    libbie.thinkingLines[0],
  );
  const [localStatus, setLocalStatus] = React.useState<string | null>(null);
  const [answeredLocally, setAnsweredLocally] = React.useState(false);
  const nonce = React.useRef(0);
  const pendingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
  }, []);

  const selectedFile: CodeFile =
    getCodeFile(selectedPath) ?? pipeline.files[0];

  const focusCode = React.useCallback((ref: CodeRef) => {
    const file = getCodeFile(ref.path);
    if (file) setSelectedPath(ref.path);
    nonce.current += 1;
    setFocus(refToFocus(ref, nonce.current));
  }, []);

  const askAnswer = React.useCallback(
    (a: Answer) => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      setView("technical");
      setThinking(true);
      setAnswer(null);
      setAnsweredLocally(false);

      const runsLocal = localMode && !!a.isLocal;
      const delay = runsLocal ? LOCAL_MS : THINK_MS;
      setLocalStatus(runsLocal ? "answering on-device · no network" : null);
      setThinkingLine(
        libbie.thinkingLines[Math.floor(Math.random() * libbie.thinkingLines.length)],
      );

      // focus the first code citation on the canvas immediately
      if (a.codeCitations[0]) focusCode(a.codeCitations[0]);

      pendingTimerRef.current = setTimeout(() => {
        setThinking(false);
        setLocalStatus(null);
        setAnswer(a);
        setAnsweredLocally(runsLocal);
        pendingTimerRef.current = null;
      }, delay);
    },
    [localMode, focusCode],
  );

  // suggested actions
  const onShowStale = React.useCallback(() => setRiskOpen(true), []);
  const onExplainForExec = React.useCallback(() => {
    if (answer) setView("executive");
  }, [answer]);

  if (!entered) {
    return (
      <div className="flex min-h-screen flex-col">
        <TopBar
          localMode={localMode}
          onLocalMode={setLocalMode}
          onAsk={() => setAskOpen(true)}
        />
        <main className="flex-1">
          <ReadingIntro
            onComplete={() => {
              setEntered(true);
              setSelectedPath(DEFAULT_FILE);
            }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <TopBar
        localMode={localMode}
        onLocalMode={setLocalMode}
        onAsk={() => setAskOpen(true)}
        onOpenFiles={() => setPipelineSheetOpen(true)}
      />

      {/* three-zone workspace */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* left rail */}
        <AnimatePresence initial={false}>
          {!leftCollapsed && (
            <motion.div
              key="left"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 264, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="hidden shrink-0 overflow-hidden lg:block"
            >
              <div className="h-full w-[264px]">
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
        <main className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3 lg:max-h-none", answer ? "max-h-[32vh]" : "max-h-[55vh]")}>
          {leftCollapsed && (
            <button
              type="button"
              onClick={() => setLeftCollapsed(false)}
              className="hidden w-fit items-center gap-1.5 rounded-lg border border-border bg-card/50 px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground lg:flex"
            >
              <PanelLeftOpen className="size-3.5" aria-hidden />
              Files
            </button>
          )}
          <CodeCanvas
            file={selectedFile}
            focus={focus}
            onLineClick={() => {
              /* selecting a file/line is a valid ask trigger — nudge toward ⌘K */
              setAskOpen(true);
            }}
          />
          {answer && <p className="text-xs text-muted-foreground lg:hidden">Source preview collapsed after the answer. Open pipeline files to view the full file.</p>}
        </main>

        {/* right rail = Libbie — a single mount.
            Below lg it stacks full-width and flows with the page; at lg it
            becomes a fixed-width pane that can collapse with a width animation. */}
        <AnimatePresence initial={false}>
          {!rightCollapsed && (
            <motion.div
              key="right"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="w-full shrink-0 lg:w-[380px] lg:overflow-hidden"
            >
              <div className="w-full lg:h-full lg:w-[380px]">
                <LibbieRail
                  answer={answer}
                  view={view}
                  onViewChange={setView}
                  thinking={thinking}
                  thinkingLine={thinkingLine}
                  localStatus={localStatus}
                  answeredLocally={answeredLocally}
                  onAskNudge={() => {
                    const a = answers.find((x) => x.id === proactiveNudge.answerId);
                    if (a) askAnswer(a);
                  }}
                  onFocusCode={focusCode}
                  onCollapse={() => setRightCollapsed(true)}
                  onShowStale={onShowStale}
                  onDraftHandover={() => {}}
                  onExplainForExec={onExplainForExec}
                  handoverSlot={<HandoverDialog />}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* mobile pipeline-tree drawer */}
      <Sheet open={pipelineSheetOpen} onOpenChange={setPipelineSheetOpen}>
        <SheetContent
          side="left"
          className="w-[300px] p-0 sm:max-w-[300px] lg:hidden"
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">Pipeline files</SheetTitle>
          <PipelineRail
            selectedPath={selectedPath}
            onSelect={(p) => {
              setSelectedPath(p);
              setPipelineSheetOpen(false);
            }}
            onCollapse={() => setPipelineSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* collapsed-rail floating orb */}
      {rightCollapsed && (
        <LibbieOrb
          onClick={() => setRightCollapsed(false)}
          proactive={!answer}
        />
      )}

      {/* ⌘K command palette */}
      <AskLibbie open={askOpen} onOpenChange={setAskOpen} onSelect={askAnswer} />

      {/* Risk panel (Libbie's watchlist) as a side sheet */}
      <Sheet open={riskOpen} onOpenChange={setRiskOpen}>
        <SheetContent
          side="right"
          className="w-full overflow-x-hidden overflow-y-auto p-4 data-[side=right]:sm:max-w-2xl"
        >
          <SheetTitle className="sr-only">Risk and staleness watchlist</SheetTitle>
          <div className="mt-4">
            <RiskPanel />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// --- top bar ------------------------------------------------------------------

function TopBar({
  localMode,
  onLocalMode,
  onAsk,
  onOpenFiles,
}: {
  localMode: boolean;
  onLocalMode: (v: boolean) => void;
  onAsk: () => void;
  /** When provided, shows a mobile-only button that opens the pipeline-tree drawer. */
  onOpenFiles?: () => void;
}) {
  const remaining = freemium.limit - freemium.used;
  return (
    <header className="sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 py-2.5 backdrop-blur">
      {onOpenFiles && (
        <button
          type="button"
          onClick={onOpenFiles}
          aria-label="Open pipeline files"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <PanelLeft className="size-4" aria-hidden />
        </button>
      )}
      <Link
        href="/"
        className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Back to home"
      >
        <ArrowLeft className="size-4" aria-hidden />
      </Link>
      <div className="flex items-center">
        <Logo className="h-6" />
      </div>

      <SampleDataBadge className="hidden sm:inline-flex" />

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {/* quiet freemium state */}
        <span className="hidden text-[11px] text-muted-foreground md:inline">
          {remaining} answers left · {freemium.resetLabel.toLowerCase()}
        </span>

        {/* air-gapped toggle */}
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch
            checked={localMode}
            onCheckedChange={onLocalMode}
            aria-label="Air-gapped local mode"
          />
          <span className={cn(localMode && "text-primary")}>Air-gapped</span>
        </label>

        {/* visible Ask Libbie (⌘K alternative) */}
        <Button onClick={onAsk} size="sm" className="gap-1.5 rounded-full">
          <Command className="size-3.5" aria-hidden />
          Ask Libbie
          <kbd className="ml-1 hidden rounded bg-primary-foreground/20 px-1 font-mono text-[10px] sm:inline">
            ⌘K
          </kbd>
        </Button>
      </div>
    </header>
  );
}
