"use client";

import * as React from "react";
import { motion } from "motion/react";
import {
  FileCode2,
  FileText,
  Settings2,
  FolderGit2,
  UserMinus,
  PanelLeftClose,
  ChevronRight,
} from "lucide-react";

import { pipeline } from "@/lib/data";
import type { CodeFile } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Group files into a small, sensible tree by their leading directory. */
function groupFiles(files: CodeFile[]): { group: string; files: CodeFile[] }[] {
  const groups = new Map<string, CodeFile[]>();
  for (const f of files) {
    const slash = f.path.indexOf("/");
    const group = slash === -1 ? "root" : f.path.slice(0, f.path.lastIndexOf("/"));
    const arr = groups.get(group) ?? [];
    arr.push(f);
    groups.set(group, arr);
  }
  // root first, then alphabetical
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "root" ? -1 : b === "root" ? 1 : a.localeCompare(b)))
    .map(([group, fs]) => ({ group, files: fs }));
}

function fileIcon(path: string) {
  if (path.endsWith(".md")) return FileText;
  if (path.endsWith(".yml") || path.endsWith(".config")) return Settings2;
  return FileCode2;
}

export function PipelineRail({
  selectedPath,
  onSelect,
  onCollapse,
}: {
  selectedPath: string;
  onSelect: (path: string) => void;
  onCollapse: () => void;
}) {
  const groups = React.useMemo(() => groupFiles(pipeline.files), []);

  return (
    <motion.aside
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-card/30"
      aria-label="Pipeline files"
    >
      {/* Connected-pipeline header */}
      <header className="border-b border-border px-3.5 py-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-code-soft text-code">
            <FolderGit2 className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[13px] font-semibold text-foreground">
              {pipeline.name}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{pipeline.repo}</p>
          </div>
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse pipeline rail"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeftClose className="size-4" aria-hidden />
          </button>
        </div>

        {/* departed-author context */}
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-conversation/30 bg-conversation-soft/40 px-2.5 py-2">
          <UserMinus className="mt-0.5 size-3.5 shrink-0 text-conversation" aria-hidden />
          <p className="text-[11px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">{pipeline.author.name}</span> (
            {pipeline.author.role}) departed{" "}
            <span className="text-conversation">{pipeline.author.departed}</span>. No handover
            was written.
          </p>
        </div>
      </header>

      {/* File tree */}
      <nav className="min-h-0 flex-1 overflow-auto px-2 py-3">
        {groups.map(({ group, files }) => (
          <div key={group} className="mb-3 last:mb-0">
            <p className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
              {group}
            </p>
            <ul className="space-y-0.5">
              {files.map((f) => {
                const Icon = fileIcon(f.path);
                const active = f.path === selectedPath;
                const name = f.path.slice(f.path.lastIndexOf("/") + 1);
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => onSelect(f.path)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                        active
                          ? "bg-code-soft/70 text-foreground ring-1 ring-code/40"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <Icon
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          active ? "text-code" : "text-muted-foreground/70",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate font-mono text-[12px]",
                            active ? "text-foreground" : "text-foreground/85",
                          )}
                        >
                          {name}
                        </span>
                        <span className="block truncate text-[10.5px] leading-tight text-muted-foreground/70">
                          {f.description}
                        </span>
                      </span>
                      <ChevronRight
                        className={cn(
                          "mt-1 size-3 shrink-0 transition-opacity",
                          active
                            ? "text-code opacity-100"
                            : "text-muted-foreground/40 opacity-0 group-hover:opacity-100",
                        )}
                        aria-hidden
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <footer className="border-t border-border px-3.5 py-2.5 font-mono text-[10px] text-muted-foreground/70">
        {pipeline.stats.files} files · {pipeline.stats.conversations} conversations ·{" "}
        {pipeline.stats.commits} commits
      </footer>
    </motion.aside>
  );
}
