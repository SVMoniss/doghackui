import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

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
import { getOrganism } from "@/lib/mesh/mesh.functions";
import { AnomaliesPanel } from "@/components/observatory/AnomaliesPanel";
import { CertificatePanel } from "@/components/observatory/CertificatePanel";
import { Constellation } from "@/components/observatory/Constellation";
import { ModalitiesPanel } from "@/components/observatory/ModalitiesPanel";

export const Route = createFileRoute("/organisms/$submissionId")({
  head: () => ({
    meta: [
      { title: "Evidence receipt — OpenJudge" },
      {
        name: "description",
        content: "The contestable evidence receipt for one hackathon project.",
      },
    ],
  }),
  component: OrganismReceiptPage,
});

function OrganismReceiptPage() {
  const { submissionId } = Route.useParams();
  const fetchOrganism = useServerFn(getOrganism);
  const organism = useQuery({
    queryKey: ["organism", submissionId],
    queryFn: () => fetchOrganism({ data: { submissionId } }),
  });

  if (organism.isLoading) {
    return <p className="mx-auto max-w-5xl px-5 py-14 font-mono text-sm">Loading the evidence receipt…</p>;
  }

  if (organism.error) {
    return (
      <p className="mx-auto max-w-5xl px-5 py-14 text-sm text-muted-foreground">
        {(organism.error as Error).message}
      </p>
    );
  }

  const data = organism.data;
  if (!data || !data.found) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-14">
        <h1 className="text-3xl font-bold tracking-tight">No evidence receipt</h1>
        <p className="mt-3 text-muted-foreground">
          This project has not connected an OpenJudge Mesh organism yet.
        </p>
      </div>
    );
  }

  const manifest = data.manifest.manifest as unknown as {
    projectId: string;
    astGraph?: { nodes: { id: string; kind: string; label: string; sourceRef: string; tags: string[] }[]; edges: { source: string; target: string; kind: string }[] };
  };
  const astGraph = manifest.astGraph ?? { nodes: [], edges: [] };
  const links = (data.links as { claim_id: string; evidence_id: string; relationship: string }[]).map(
    (l) => ({ claimId: l.claim_id, evidenceId: l.evidence_id, relationship: l.relationship }),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-5 py-14">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Evidence receipt · {manifest.projectId}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Contestable decision receipt</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant={data.manifest.sealed ? "default" : "secondary"}>
            {data.manifest.sealed ? "sealed" : "unsealed"}
          </Badge>
          <Badge variant="outline">{data.eligibility.status}</Badge>
          <Badge variant="outline">{data.evidence.signal}</Badge>
        </div>
        <p className="mt-3 font-mono text-xs text-muted-foreground">
          merkle {data.manifest.merkle_root.slice(0, 16)}… · agent {data.manifest.agent_version} · pairing{" "}
          {data.manifest.merkle_root.slice(0, 12)}
        </p>
      </header>

      <CertificatePanel certificate={data.certificate} />

      <section aria-label="Evidence sufficiency">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evidence sufficiency</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              Sufficiency {data.evidence.sufficiency.toFixed(2)} against a target of{" "}
              {data.evidence.target.toFixed(2)} — signal: <strong>{data.evidence.signal}</strong>. This
              signal is visible to everyone and never modifies the score.
            </p>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Claims">
        <h2 className="mb-3 text-xl font-semibold">Claims</h2>
        <Table aria-label="Project claims and their support status">
          <TableHeader>
            <TableRow>
              <TableHead>Claim</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data.claims as { claim_id: string; statement: string; category: string; status: string }[]).map(
              (claim) => (
                <TableRow key={claim.claim_id}>
                  <TableCell>
                    <span className="font-medium">{claim.claim_id}</span>
                    <span className="block text-xs text-muted-foreground">{claim.statement}</span>
                  </TableCell>
                  <TableCell>{claim.category}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        claim.status === "SUPPORTED"
                          ? "default"
                          : claim.status === "CONTRADICTED"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {claim.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      </section>

      <section aria-label="Evidence constellation">
        <h2 className="mb-3 text-xl font-semibold">Evidence constellation</h2>
        <Constellation nodes={astGraph.nodes} edges={astGraph.edges} links={links} highContrast={false} />
      </section>

      <ModalitiesPanel
        modalities={
          data.modalities as {
            id: string;
            title: string;
            captures: string;
            judgeSees: string;
            status: "present" | "missing";
            artifactIds: string[];
          }[]
        }
        artifacts={
          data.artifacts as {
            artifact_id: string;
            kind: string;
            content_hash: string;
            uri: string;
            artifact_created_at: string | null;
            provenance: Record<string, unknown>;
          }[]
        }
        links={
          data.links as {
            claim_id: string;
            evidence_id: string;
            relationship: string;
            explanation: string;
          }[]
        }
      />

      <section aria-label="Evidence artifacts">
        <h2 className="mb-3 text-xl font-semibold">Evidence artifacts</h2>
        <Table aria-label="Evidence artifacts referenced by content hash">
          <TableHeader>
            <TableRow>
              <TableHead>Artifact</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Content hash</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(
              data.artifacts as { artifact_id: string; kind: string; content_hash: string; uri: string }[]
            ).map((artifact) => (
              <TableRow key={artifact.artifact_id}>
                <TableCell className="font-mono text-xs">{artifact.artifact_id}</TableCell>
                <TableCell>{artifact.kind}</TableCell>
                <TableCell className="font-mono text-xs">{artifact.content_hash.slice(0, 20)}…</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section aria-label="Replay runs">
        <h2 className="mb-3 text-xl font-semibold">Replay runs</h2>
        {(data.runs as { id: string; scenario_id: string; status: string }[]).length === 0 ? (
          <p className="text-sm text-muted-foreground">No replay runs recorded.</p>
        ) : (
          <ul className="space-y-2">
            {(data.runs as { id: string; scenario_id: string; status: string }[]).map((run) => (
              <li key={run.id} className="flex items-center gap-2 text-sm">
                <Badge variant={run.status === "passed" ? "default" : "destructive"}>{run.status}</Badge>
                <span className="font-mono text-xs">{run.scenario_id}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Anomalies">
        <h2 className="mb-3 text-xl font-semibold">Anomalies</h2>
        <AnomaliesPanel
          anomalies={
            data.anomalies as {
              id: string;
              anomaly_key: string;
              severity: string;
              category: string;
              finding: string;
              confidence: number;
              evidence_refs: string[];
              allowed_actions: string[];
              state: string;
              resolution: string | null;
            }[]
          }
          canAct={false}
        />
      </section>

      <section aria-label="Human assessments">
        <h2 className="mb-3 text-xl font-semibold">Human assessments</h2>
        {(data.assessments as { criterion: string; score: number; assessorLabel: string; rationale: string }[])
          .length === 0 ? (
          <p className="text-sm text-muted-foreground">No criterion assessments submitted yet.</p>
        ) : (
          <Table aria-label="Anonymized human assessments">
            <TableHeader>
              <TableRow>
                <TableHead>Assessor</TableHead>
                <TableHead>Criterion</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Rationale</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(
                data.assessments as {
                  criterion: string;
                  score: number;
                  assessorLabel: string;
                  rationale: string;
                }[]
              ).map((assessment, index) => (
                <TableRow key={index}>
                  <TableCell>{assessment.assessorLabel}</TableCell>
                  <TableCell>{assessment.criterion}</TableCell>
                  <TableCell>{assessment.score}/10</TableCell>
                  <TableCell className="max-w-72 truncate text-xs text-muted-foreground">
                    {assessment.rationale}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Judges are anonymized. Automated checks never score — every number above was entered by a human.
        </p>
      </section>
    </div>
  );
}
