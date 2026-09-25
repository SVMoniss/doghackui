import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type ConstellationNode = {
  id: string;
  kind: string;
  label: string;
  sourceRef: string;
  tags: string[];
};

export type ConstellationEdge = {
  source: string;
  target: string;
  kind: string;
};

const KIND_ORDER = ["module", "function", "class", "endpoint", "table", "test"];

const KIND_COLORS: Record<string, string> = {
  module: "fill-sky-400",
  function: "fill-violet-400",
  class: "fill-fuchsia-400",
  endpoint: "fill-emerald-400",
  table: "fill-amber-400",
  test: "fill-rose-400",
};

/**
 * Explorable AST constellation: modules, symbols, endpoints, tables, and the
 * tests that cover them. Static SVG (no animation, so reduced-motion safe);
 * every node is keyboard-focusable with a screen-reader label, and the same
 * data is always available as tables below the graph.
 */
export function Constellation({
  nodes,
  edges,
  links,
  highContrast,
}: {
  nodes: ConstellationNode[];
  edges: ConstellationEdge[];
  links: { claimId: string; evidenceId: string; relationship: string }[];
  highContrast: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const layout = useMemo(() => {
    const width = 640;
    const height = 420;
    const cx = width / 2;
    const cy = height / 2;
    const byKind = new Map<string, ConstellationNode[]>();
    for (const node of nodes) {
      const bucket = byKind.get(node.kind) ?? [];
      bucket.push(node);
      byKind.set(node.kind, bucket);
    }
    const positions = new Map<string, { x: number; y: number }>();
    const kinds = KIND_ORDER.filter((kind) => byKind.has(kind));
    kinds.forEach((kind, ring) => {
      const bucket = byKind.get(kind)!;
      const radius = 70 + ring * 52;
      bucket.forEach((node, index) => {
        if (bucket.length === 1) {
          positions.set(node.id, { x: cx, y: Math.max(30, cy - radius) });
        } else {
          const angle = (2 * Math.PI * index) / bucket.length - Math.PI / 2;
          positions.set(node.id, {
            x: Math.min(width - 20, Math.max(20, cx + radius * Math.cos(angle) * 1.35)),
            y: Math.min(height - 20, Math.max(20, cy + radius * Math.sin(angle))),
          });
        }
      });
    });
    return { positions, width, height };
  }, [nodes]);

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const neighbourhood = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set<string>([selectedId]);
    for (const edge of edges) {
      if (edge.source === selectedId) ids.add(edge.target);
      if (edge.target === selectedId) ids.add(edge.source);
    }
    return ids;
  }, [edges, selectedId]);

  const relatedLinks = selected
    ? links.filter((l) => l.evidenceId === selected.id || l.claimId === selected.id)
    : [];

  if (nodes.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          No structural graph was submitted with this manifest yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={highContrast ? "border-2 border-foreground" : undefined}>
      <CardHeader>
        <CardTitle className="text-base">AST constellation</CardTitle>
      </CardHeader>
      <CardContent>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className={`w-full rounded-md border ${highContrast ? "border-foreground bg-black" : "bg-muted/30"}`}
          role="img"
          aria-label={`Code structure graph with ${nodes.length} nodes and ${edges.length} connections. Use Tab to move between nodes and Enter to inspect one.`}
        >
          {edges.map((edge, index) => {
            const a = layout.positions.get(edge.source);
            const b = layout.positions.get(edge.target);
            if (!a || !b) return null;
            const active = neighbourhood && neighbourhood.has(edge.source) && neighbourhood.has(edge.target);
            return (
              <line
                key={`${edge.source}-${edge.target}-${index}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                strokeWidth={active ? 2 : 1}
                className={
                  active ? "stroke-primary" : highContrast ? "stroke-white/40" : "stroke-border"
                }
                opacity={neighbourhood && !active ? 0.25 : 1}
              />
            );
          })}
          {nodes.map((node) => {
            const pos = layout.positions.get(node.id);
            if (!pos) return null;
            const dimmed = neighbourhood && !neighbourhood.has(node.id);
            const isSelected = node.id === selectedId;
            return (
              <g
                key={node.id}
                tabIndex={0}
                role="button"
                aria-label={`${node.kind} ${node.label}. ${node.tags.join(", ")}. Press Enter to inspect.`}
                transform={`translate(${pos.x},${pos.y})`}
                opacity={dimmed ? 0.3 : 1}
                onClick={() => setSelectedId(isSelected ? null : node.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedId(isSelected ? null : node.id);
                  }
                  if (event.key === "Escape") setSelectedId(null);
                }}
                className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <circle
                  r={isSelected ? 10 : 7}
                  className={`${KIND_COLORS[node.kind] ?? "fill-gray-400"} ${isSelected ? "stroke-primary" : highContrast ? "stroke-white" : "stroke-background"} stroke-2`}
                />
                <text
                  y={-12}
                  textAnchor="middle"
                  fontSize={10}
                  className={highContrast ? "fill-white" : "fill-foreground"}
                >
                  {node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="mt-3 flex flex-wrap gap-2" aria-label="Legend">
          {KIND_ORDER.map((kind) => (
            <Badge key={kind} variant="outline">
              {kind}
            </Badge>
          ))}
        </div>

        <div aria-live="polite" className="mt-4 text-sm">
          {selected ? (
            <div className="rounded-md border p-3">
              <p className="font-medium">
                {selected.kind}: {selected.label}
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{selected.sourceRef}</p>
              {selected.tags.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Tags: {selected.tags.join(", ")}</p>
              )}
              {relatedLinks.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {relatedLinks.map((link, index) => (
                    <li key={index}>
                      Evidence link: {link.relationship} (claim {link.claimId})
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">No claim-evidence links touch this node.</p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">Select a node to inspect its source, tags, and evidence links.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
