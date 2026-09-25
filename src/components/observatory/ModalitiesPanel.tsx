import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ModalityCoverage = {
  id: string;
  title: string;
  captures: string;
  judgeSees: string;
  status: "present" | "missing";
  artifactIds: string[];
};

export type ViewerArtifact = {
  artifact_id: string;
  kind: string;
  content_hash: string;
  uri: string;
  artifact_created_at: string | null;
  provenance: Record<string, unknown>;
};

export type ViewerLink = {
  claim_id: string;
  evidence_id: string;
  relationship: string;
  explanation: string;
};

const VIEWER_KINDS = new Set(["interaction_trace", "interaction_recording", "spatial_demo_scene"]);

/**
 * The six evidence modalities: what was captured, what a judge can inspect,
 * and whether this organism actually has it. Missing modalities are shown as
 * missing — never silently implied.
 */
export function ModalitiesPanel({
  modalities,
  artifacts,
  links,
}: {
  modalities: ModalityCoverage[];
  artifacts: ViewerArtifact[];
  links: ViewerLink[];
}) {
  const milestones = artifacts
    .filter((a) => a.kind === "milestone_attestation")
    .slice()
    .sort((a, b) => String(a.artifact_created_at ?? "").localeCompare(String(b.artifact_created_at ?? "")));
  const viewables = artifacts.filter((a) => VIEWER_KINDS.has(a.kind));

  return (
    <div className="space-y-6">
      <section aria-label="Evidence modalities">
        <h2 className="mb-3 text-xl font-semibold">Evidence modalities</h2>
        <Table aria-label="What each evidence modality captured">
          <TableHeader>
            <TableRow>
              <TableHead>Modality</TableHead>
              <TableHead>What a judge can inspect</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {modalities.map((modality) => (
              <TableRow key={modality.id}>
                <TableCell>
                  <span className="font-medium">{modality.title}</span>
                  <span className="block text-xs text-muted-foreground">{modality.captures}</span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{modality.judgeSees}</TableCell>
                <TableCell>
                  <Badge variant={modality.status === "present" ? "default" : "secondary"}>
                    {modality.status === "present"
                      ? `present (${modality.artifactIds.length})`
                      : "missing"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section aria-label="Milestone timeline">
        <h2 className="mb-3 text-xl font-semibold">Milestone timeline</h2>
        {milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No milestone checkpoints recorded. Checkpoints hash project state at meaningful moments —
            never keystrokes or screen activity.
          </p>
        ) : (
          <ol className="space-y-2">
            {milestones.map((milestone) => (
              <li key={milestone.artifact_id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
                <Badge variant="outline">{milestone.artifact_id}</Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  {milestone.content_hash.slice(0, 20)}…
                  {milestone.artifact_created_at
                    ? ` · ${new Date(milestone.artifact_created_at).toLocaleString()}`
                    : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {viewables.length > 0 && (
        <section aria-label="Traces and demo scenes">
          <h2 className="mb-3 text-xl font-semibold">Traces and demo scenes</h2>
          <div className="space-y-3">
            {viewables.map((artifact) => {
              const artifactLinks = links.filter((l) => l.evidence_id === artifact.artifact_id);
              const provenance = artifact.provenance ?? {};
              return (
                <Card key={artifact.artifact_id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-xs">{artifact.artifact_id}</span>
                      <Badge variant="outline">{artifact.kind}</Badge>
                      <Badge variant={provenance["trusted"] ? "default" : "secondary"}>
                        {provenance["trusted"] ? "agent-observed" : "participant-supplied"}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="font-mono text-xs text-muted-foreground">
                      hash {artifact.content_hash.slice(0, 20)}…
                      {typeof provenance["sourceRef"] === "string" ? ` · ${provenance["sourceRef"]}` : ""}
                      {typeof provenance["bytes"] === "number" ? ` · ${provenance["bytes"]} bytes` : ""}
                    </p>
                    {artifactLinks.length > 0 ? (
                      <ul className="space-y-1 text-xs">
                        {artifactLinks.map((link, index) => (
                          <li key={index}>
                            {link.relationship} → claim {link.claim_id}: {link.explanation}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">No claim links touch this recording.</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Contents stay on the participant machine; this receipt references them by hash.
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
