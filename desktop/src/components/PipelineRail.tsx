import * as React from "react";
import { FileCode2, FileText, FolderClosed, PanelLeftClose, UserMinus } from "lucide-react";

import { pipeline } from "@/lib/data";
import { cn } from "@/lib/utils";

/** Group the pipeline's flat file list into a shallow directory tree. */
function grouped() {
  const groups = new Map<string, { path: string; name: string; description: string }[]>();
  for (const f of pipeline.files) {
    const idx = f.path.lastIndexOf("/");
    const dir = idx === -1 ? "." : f.path.slice(0, idx);
    const name = idx === -1 ? f.path : f.path.slice(idx + 1);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push({ path: f.path, name, description: f.description });
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function PipelineRail({
  selectedPath,
  onSelect,
  onCollapse,
}: {
  selectedPath: string;
  onSelect: (path: string) => void;
  onCollapse?: () => void;
}) {
  const tree = React.useMemo(grouped, []);

  return (
    <aside className="flex h-full flex-col border-r border-border bg-sidebar/60">
      {/* header — connected pipeline + author-departed context */}
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-foreground">{pipeline.name}</p>
            <p className="truncate font-mono text-[10.5px] text-muted-foreground">{pipeline.repo}</p>
          </div>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Collapse file tree"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PanelLeftClose className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-warn/10 px-2 py-1.5 text-[11px] text-warn">
          <UserMinus className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {pipeline.author.name} left · {pipeline.author.departed}
          </span>
        </div>
      </header>

      {/* file tree */}
      <nav className="scroll-soft min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {tree.map(([dir, files]) => (
          <div key={dir} className="mb-3">
            <div className="mb-1 flex items-center gap-1.5 px-2 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
              <FolderClosed className="size-3" aria-hidden />
              <span className="truncate font-mono normal-case">{dir === "." ? "root" : dir}</span>
            </div>
            <ul>
              {files.map((f) => {
                const active = f.path === selectedPath;
                const isCode = /\.(nf|config|py|sh|groovy)$/.test(f.name);
                const Icon = isCode ? FileCode2 : FileText;
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => onSelect(f.path)}
                      title={f.description}
                      className={cn(
                        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors",
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-foreground/80 hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-3.5 shrink-0",
                          active ? "text-primary" : "text-muted-foreground",
                        )}
                        aria-hidden
                      />
                      <span className="truncate font-mono">{f.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <footer className="border-t border-border px-4 py-2.5 text-[10.5px] text-muted-foreground">
        {pipeline.stats.files} files · {pipeline.stats.conversations} conversations ·{" "}
        {pipeline.stats.commits} commits
      </footer>
    </aside>
  );
}
