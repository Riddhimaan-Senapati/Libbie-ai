import * as React from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import {
  Waypoints,
  Maximize2,
  FolderOpen,
  X,
  ArrowRight,
  ArrowLeft,
  Info,
} from "lucide-react";

import {
  normalizeGraph,
  parseGraphJson,
  colorForKind,
  labelForKind,
  KIND_COLORS,
  type NormalizedGraph,
  type GNode,
  type GLink,
  type RawGraph,
} from "@/lib/graph";
import { openGraphJson, isTauri, errorMessage } from "@/lib/tauri";
import { cn } from "@/lib/utils";

// Colours mirror the CSS theme tokens (see styles/globals.css). The app ships a
// light-only Benchling theme, so these are the resolved token values.
const FOREGROUND = "#000650"; // --foreground
const COMMITTED_LINK = "rgba(74, 85, 120, 0.32)"; // --muted-foreground, softened
const HYPOTHESIS_LINK = "#b45309"; // amber (kin to --warn) — inferred edges
const DIM_LINK = "rgba(74, 85, 120, 0.07)";

/** Edge type that dominates the graph (file↔person); hidden by default so the
 *  structural edges stay legible. */
const NOISY_EDGE_TYPE = "authored_by";

// The 412 KB sample fixture ships as a public/ asset fetched on demand; bundling
// it inline put a 327 KB object literal into this lazy chunk.
const EMPTY_GRAPH: NormalizedGraph = normalizeGraph({ nodes: {}, edges: [] });

type Endpoint = string | { id: string };
const endpointId = (e: Endpoint): string => (typeof e === "string" ? e : e.id);

/** Neighbour/edge record for the inspector. */
interface Incident {
  link: GLink;
  neighborId: string;
  /** true when the selected node is the edge source (points away). */
  outgoing: boolean;
}

export function GraphView() {
  const [master, setMaster] = React.useState<NormalizedGraph>(EMPTY_GRAPH);
  const [source, setSource] = React.useState<string>("Sample provenance graph");
  const [error, setError] = React.useState<string | null>(null);

  // Load the sample fixture from public/ (kept out of the JS bundle).
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const resp = await fetch("sample-graph.json");
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const raw = (await resp.json()) as unknown as RawGraph;
        if (!alive) return;
        setMaster(normalizeGraph(raw));
      } catch (e) {
        if (alive) setError(`Could not load the sample graph: ${String(e)}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = React.useState<Set<string>>(
    () => new Set([NOISY_EDGE_TYPE]),
  );
  const [hiddenKinds, setHiddenKinds] = React.useState<Set<string>>(() => new Set());
  const [hideUnconnected, setHideUnconnected] = React.useState(true);

  const fgRef = React.useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const fittedForRef = React.useRef<NormalizedGraph | null>(null);

  // Size the canvas to its container (a flex pane; the library's own auto-size
  // misbehaves inside flexbox, so we drive width/height explicitly).
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The distinct edge types + node kinds present, for the filter controls.
  const edgeTypes = React.useMemo(() => {
    const s = new Set<string>();
    for (const l of master.links) s.add(l.type);
    return [...s].sort();
  }, [master]);

  const nodeKinds = React.useMemo(() => {
    const s = new Set<string>();
    for (const n of master.nodes) s.add(n.kind);
    return [...s].sort();
  }, [master]);

  // All incident edges per node (computed from the immutable master, tolerant of
  // the library having replaced link.source/target with node objects).
  const incidence = React.useMemo(() => {
    const m = new Map<string, Incident[]>();
    for (const l of master.links) {
      const s = endpointId(l.source as Endpoint);
      const t = endpointId(l.target as Endpoint);
      (m.get(s) ?? m.set(s, []).get(s)!).push({ link: l, neighborId: t, outgoing: true });
      (m.get(t) ?? m.set(t, []).get(t)!).push({ link: l, neighborId: s, outgoing: false });
    }
    return m;
  }, [master]);

  // The visible subgraph after applying the kind / edge-type / orphan filters.
  const filtered = React.useMemo<NormalizedGraph>(() => {
    const nodeById = new Map(master.nodes.map((n) => [n.id, n]));
    const links = master.links.filter((l) => {
      if (hiddenEdgeTypes.has(l.type)) return false;
      const s = nodeById.get(endpointId(l.source as Endpoint));
      const t = nodeById.get(endpointId(l.target as Endpoint));
      if (!s || !t) return false;
      return !hiddenKinds.has(s.kind) && !hiddenKinds.has(t.kind);
    });
    const connected = new Set<string>();
    for (const l of links) {
      connected.add(endpointId(l.source as Endpoint));
      connected.add(endpointId(l.target as Endpoint));
    }
    const nodes = master.nodes.filter((n) => {
      if (hiddenKinds.has(n.kind)) return false;
      if (hideUnconnected && !connected.has(n.id)) return false;
      return true;
    });
    return { nodes, links };
  }, [master, hiddenEdgeTypes, hiddenKinds, hideUnconnected]);

  // Degree over the *visible* links → node size.
  const degree = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtered.links) {
      const s = endpointId(l.source as Endpoint);
      const t = endpointId(l.target as Endpoint);
      m.set(s, (m.get(s) ?? 0) + 1);
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, [filtered]);

  // Neighbours of the selected node among the visible links (for highlighting).
  const neighborIds = React.useMemo(() => {
    const s = new Set<string>();
    if (!selectedId) return s;
    for (const l of filtered.links) {
      const a = endpointId(l.source as Endpoint);
      const b = endpointId(l.target as Endpoint);
      if (a === selectedId) s.add(b);
      else if (b === selectedId) s.add(a);
    }
    return s;
  }, [selectedId, filtered]);

  const selectedNode = React.useMemo(
    () => (selectedId ? master.nodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, master],
  );

  const nodeById = React.useMemo(
    () => new Map(master.nodes.map((n) => [n.id, n])),
    [master],
  );

  const fit = React.useCallback(() => {
    fgRef.current?.zoomToFit(400, 48);
  }, []);

  // Fit once whenever a new graph is loaded (after the layout has settled).
  const handleEngineStop = React.useCallback(() => {
    if (fittedForRef.current !== master) {
      fittedForRef.current = master;
      fit();
    }
  }, [master, fit]);

  const radius = React.useCallback(
    (node: GNode) => {
      const d = degree.get(node.id) ?? 0;
      return Math.min(3 + Math.sqrt(d) * 1.15, 11);
    },
    [degree],
  );

  const drawNode = React.useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const x = (node as GNode & { x?: number }).x ?? 0;
      const y = (node as GNode & { y?: number }).y ?? 0;
      const r = radius(node);
      const selected = node.id === selectedId;
      const active = !selectedId || selected || neighborIds.has(node.id);

      ctx.globalAlpha = active ? 1 : 0.2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = colorForKind(node.kind);
      ctx.fill();
      if (selected) {
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = FOREGROUND;
        ctx.stroke();
      }

      // Labels appear when zoomed in, or for the selection + its neighbours.
      const showLabel = selected || (active && (scale > 1.4 || neighborIds.has(node.id)));
      if (showLabel && node.label) {
        const fontSize = Math.max(11 / scale, 1.5);
        ctx.font = `${fontSize}px "Hanken Grotesk", system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = FOREGROUND;
        ctx.fillText(node.label, x + r + 3 / scale, y);
      }
      ctx.globalAlpha = 1;
    },
    [radius, selectedId, neighborIds],
  );

  const drawNodePointerArea = React.useCallback(
    (node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
      const x = (node as GNode & { x?: number }).x ?? 0;
      const y = (node as GNode & { y?: number }).y ?? 0;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius(node) + 2, 0, 2 * Math.PI);
      ctx.fill();
    },
    [radius],
  );

  const linkColor = React.useCallback(
    (l: GLink) => {
      if (selectedId) {
        const inc =
          endpointId(l.source as Endpoint) === selectedId ||
          endpointId(l.target as Endpoint) === selectedId;
        if (!inc) return DIM_LINK;
      }
      return l.status === "hypothesis" ? HYPOTHESIS_LINK : COMMITTED_LINK;
    },
    [selectedId],
  );

  const loadFromFile = React.useCallback(async () => {
    setError(null);
    if (!isTauri()) {
      setError("Loading a graph file is only available in the desktop app.");
      return;
    }
    try {
      // The Rust core opens the OS file picker and returns the chosen file's
      // contents (or null if cancelled) — the webview never handles the path.
      const text = await openGraphJson();
      if (text === null) return; // cancelled
      const g = parseGraphJson(text);
      fittedForRef.current = null;
      setMaster(g);
      setSelectedId(null);
      setSource("loaded graph");
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const isEmpty = master.nodes.length === 0;

  return (
    <div className="flex h-full min-h-0">
      {/* controls: legend + filters */}
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <ControlSection title="Legend">
            <ul className="space-y-1.5">
              {nodeKinds.map((k) => (
                <li key={k} className="flex items-center gap-2 text-[12px] text-foreground/85">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: KIND_COLORS[k] ?? colorForKind(k) }}
                    aria-hidden
                  />
                  {labelForKind(k)}
                </li>
              ))}
            </ul>
            <div className="mt-3 space-y-1.5 border-t border-border pt-3">
              <LinkLegend label="Committed" color={COMMITTED_LINK} dashed={false} />
              <LinkLegend label="Hypothesis" color={HYPOTHESIS_LINK} dashed />
              <p className="pt-1 text-[10.5px] leading-snug text-muted-foreground">
                Line thickness scales with edge confidence.
              </p>
            </div>
          </ControlSection>

          <ControlSection title="Edge types">
            {edgeTypes.map((t) => (
              <FilterRow
                key={t}
                label={t}
                checked={!hiddenEdgeTypes.has(t)}
                onChange={() =>
                  setHiddenEdgeTypes((prev) => toggle(prev, t))
                }
              />
            ))}
          </ControlSection>

          <ControlSection title="Node kinds">
            {nodeKinds.map((k) => (
              <FilterRow
                key={k}
                label={labelForKind(k)}
                color={KIND_COLORS[k] ?? colorForKind(k)}
                checked={!hiddenKinds.has(k)}
                onChange={() => setHiddenKinds((prev) => toggle(prev, k))}
              />
            ))}
          </ControlSection>

          <label className="mt-1 flex cursor-pointer items-center gap-2 text-[12px] text-foreground/85">
            <input
              type="checkbox"
              className="accent-primary"
              checked={hideUnconnected}
              onChange={() => setHideUnconnected((v) => !v)}
            />
            Hide unconnected nodes
          </label>
        </div>
      </aside>

      {/* canvas */}
      <div ref={wrapRef} className="relative min-w-0 flex-1 overflow-hidden bg-background bg-grid">
        {/* toolbar overlay */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-background/85 px-3 py-1.5 text-[11.5px] text-muted-foreground backdrop-blur">
            <Waypoints className="size-3.5 text-primary" aria-hidden />
            <span className="font-medium text-foreground">{source}</span>
            <span className="text-border">·</span>
            <span className="font-mono">
              {filtered.nodes.length}/{master.nodes.length} nodes
            </span>
            <span className="text-border">·</span>
            <span className="font-mono">
              {filtered.links.length}/{master.links.length} edges
            </span>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={fit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/85 px-2.5 py-1.5 text-[12px] text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
            >
              <Maximize2 className="size-3.5" aria-hidden />
              Fit
            </button>
            <button
              type="button"
              onClick={loadFromFile}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/85 px-2.5 py-1.5 text-[12px] text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
            >
              <FolderOpen className="size-3.5" aria-hidden />
              Load graph.json…
            </button>
          </div>
        </div>

        {error && (
          <div className="pointer-events-auto absolute inset-x-0 top-16 z-10 mx-auto w-fit max-w-[80%] rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}

        {isEmpty ? (
          <EmptyState onLoad={loadFromFile} />
        ) : (
          <ForceGraph2D<GNode, GLink>
            ref={fgRef}
            width={size.width || undefined}
            height={size.height || undefined}
            graphData={filtered}
            backgroundColor="rgba(0,0,0,0)"
            nodeRelSize={4}
            nodeCanvasObject={drawNode}
            nodePointerAreaPaint={drawNodePointerArea}
            nodeLabel={(n) => `${labelForKind(n.kind)}: ${n.label}`}
            linkColor={linkColor}
            linkWidth={(l) => 0.5 + 3 * (l.confidence ?? 1)}
            linkLineDash={(l) => (l.status === "hypothesis" ? [4, 4] : null)}
            linkDirectionalArrowLength={2.6}
            linkDirectionalArrowRelPos={1}
            linkDirectionalArrowColor={linkColor}
            cooldownTicks={120}
            onEngineStop={handleEngineStop}
            onNodeClick={(n) => setSelectedId((cur) => (cur === n.id ? null : n.id))}
            onBackgroundClick={() => setSelectedId(null)}
          />
        )}
      </div>

      {/* inspector */}
      {selectedNode && (
        <Inspector
          node={selectedNode}
          incident={incidence.get(selectedNode.id) ?? []}
          nodeById={nodeById}
          onSelect={setSelectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function toggle(prev: Set<string>, key: string): Set<string> {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function ControlSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </section>
  );
}

function LinkLegend({ label, color, dashed }: { label: string; color: string; dashed: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-foreground/85">
      <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden className="shrink-0">
        <line
          x1="1"
          y1="4"
          x2="21"
          y2="4"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? "4 3" : undefined}
        />
      </svg>
      {label}
    </div>
  );
}

function FilterRow({
  label,
  checked,
  onChange,
  color,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  color?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-[12px] text-foreground/85">
      <input type="checkbox" className="accent-primary" checked={checked} onChange={onChange} />
      {color && (
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      <span className="truncate font-mono text-[11.5px]">{label}</span>
    </label>
  );
}

function EmptyState({ onLoad }: { onLoad: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <Waypoints className="size-10 text-muted-foreground/50" aria-hidden />
      <p className="text-[14px] font-medium text-foreground">No provenance graph loaded</p>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
        Run <span className="font-mono text-foreground">libbie join</span> to build a provenance
        graph, then load its <span className="font-mono text-foreground">graph.json</span>.
      </p>
      <button
        type="button"
        onClick={onLoad}
        className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground"
      >
        <FolderOpen className="size-3.5" aria-hidden />
        Load graph.json…
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Inspector({
  node,
  incident,
  nodeById,
  onSelect,
  onClose,
}: {
  node: GNode;
  incident: Incident[];
  nodeById: Map<string, GNode>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="flex w-[336px] shrink-0 flex-col border-l border-border bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: colorForKind(node.kind) }}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {labelForKind(node.kind)}
            </p>
            <p className="truncate text-[13.5px] font-semibold text-foreground">{node.label}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="scroll-soft selectable min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <SectionLabel>Fields</SectionLabel>
        <dl className="mb-5 space-y-1.5">
          <Field label="id" value={node.id} mono />
          {Object.entries(node.fields).map(([k, v]) => (
            <Field key={k} label={k} value={formatValue(v)} mono />
          ))}
        </dl>

        <SectionLabel>
          Edges <span className="text-muted-foreground/70">({incident.length})</span>
        </SectionLabel>
        {incident.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No incident edges.</p>
        ) : (
          <ul className="space-y-2">
            {incident.map((inc, i) => {
              const neighbor = nodeById.get(inc.neighborId);
              return (
                <li
                  key={`${inc.link.id}-${i}`}
                  className={cn(
                    "rounded-lg border p-2.5",
                    inc.link.status === "hypothesis"
                      ? "border-warn/40 bg-warn/5"
                      : "border-border bg-card",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-mono text-[11.5px] font-medium text-foreground">
                      {inc.outgoing ? (
                        <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                      ) : (
                        <ArrowLeft className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      {inc.link.type}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide",
                        inc.link.status === "hypothesis"
                          ? "bg-warn/15 text-warn"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {inc.link.status}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelect(inc.neighborId)}
                    className="mt-1.5 flex w-full items-center gap-1.5 text-left text-[12px] text-primary hover:underline"
                    title={inc.neighborId}
                  >
                    {neighbor && (
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: colorForKind(neighbor.kind) }}
                        aria-hidden
                      />
                    )}
                    <span className="truncate">{neighbor?.label ?? inc.neighborId}</span>
                  </button>
                  <p className="mt-1 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
                    <span>conf {(inc.link.confidence ?? 1).toFixed(2)}</span>
                  </p>
                  {inc.link.rationale && (
                    <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-foreground/80">
                      <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
                      {inc.link.rationale}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2">
      <dt className="truncate font-mono text-[11px] text-muted-foreground" title={label}>
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 break-words text-[12px] text-foreground/90",
          mono && "font-mono text-[11.5px]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length ? v.map((x) => formatValue(x)).join(", ") : "—";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
