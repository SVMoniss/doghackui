import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AnomaliesPanel } from "@/components/observatory/AnomaliesPanel";
import { AssessmentForm } from "@/components/observatory/AssessmentForm";
import { CertificatePanel } from "@/components/observatory/CertificatePanel";
import { Constellation } from "@/components/observatory/Constellation";
import { WEIGHTS, normalizedScore } from "@/lib/engine/scoring";
import { stressSensitivities } from "@/lib/engine/evidence";
import {
  addClaimLink,
  createClaim,
  getOrganism,
  ingestManifest,
  myOrganisms,
  sealOrganism,
  setEligibility,
  submitReplayRun,
  type OrganismPayload,
} from "@/lib/mesh/mesh.functions";
import { myAccess, myProjects } from "@/lib/participant.functions";

export const Route = createFileRoute("/_authenticated/observatory")({
  head: () => ({
    meta: [
      { title: "Observatory — OpenJudge" },
      {
        name: "description",
        content: "The decision laboratory: evidence, rubric, and decision orbits for one project organism.",
      },
    ],
  }),
  component: ObservatoryPage,
});

type LoadedOrganism = Extract<OrganismPayload, { found: true }>;

function ObservatoryPage() {
  const fetchProjects = useServerFn(myProjects);
  const fetchMine = useServerFn(myOrganisms);
  const fetchAccess = useServerFn(myAccess);
  const projects = useQuery({ queryKey: ["my-projects"], queryFn: () => fetchProjects() });
  const mine = useQuery({ queryKey: ["my-organisms"], queryFn: () => fetchMine() });
  const access = useQuery({ queryKey: ["my-access"], queryFn: () => fetchAccess() });

  const [submissionId, setSubmissionId] = useState<string>("");
  const activeSubmission = (projects.data ?? []).find((p) => p.id === submissionId) ?? null;

  const fetchOrganism = useServerFn(getOrganism);
  const organism = useQuery({
    queryKey: ["organism", submissionId],
    queryFn: () => fetchOrganism({ data: { submissionId } }),
    enabled: submissionId.length > 0,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-5 py-14">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Project nucleus · decision laboratory
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">The Observatory</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Describe the promise, connect the local project, watch evidence ingestion, resolve anomalies,
          stress-test the evaluation model, then seal the submission.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select your project</CardTitle>
        </CardHeader>
        <CardContent>
          {projects.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading your projects…</p>
          ) : (projects.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No projects yet. Submit one first, then return here to grow its organism.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(projects.data ?? []).map((project) => (
                <Button
                  key={project.id}
                  variant={project.id === submissionId ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSubmissionId(project.id)}
                >
                  {project.title}
                </Button>
              ))}
            </div>
          )}
          {(mine.data ?? []).length > 0 && (
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              Sealed organisms:{" "}
              {(mine.data ?? []).map((m) => `${m.project_ref}${m.sealed ? " (sealed)" : ""}`).join(" · ")}
            </p>
          )}
        </CardContent>
      </Card>

      {!activeSubmission ? null : organism.isLoading ? (
        <p className="font-mono text-sm">Loading the organism…</p>
      ) : organism.error ? (
        <p className="text-sm text-muted-foreground">{(organism.error as Error).message}</p>
      ) : organism.data && organism.data.found ? (
        <OrganismWorkspace
          organism={organism.data}
          submissionId={submissionId}
          eventId={activeSubmission.event_id}
          isOrganizer={(access.data?.roles ?? []).includes("organizer")}
        />
      ) : (
        <ConnectPanel
          submissionId={submissionId}
          eventId={activeSubmission.event_id}
          teamName={activeSubmission.team_name}
          onConnected={() => organism.refetch()}
        />
      )}
    </div>
  );
}

/** First-run state: draft claims locally, then import the signed manifest. */
function ConnectPanel({
  submissionId,
  eventId,
  teamName,
  onConnected,
}: {
  submissionId: string;
  eventId: string;
  teamName: string;
  onConnected: () => void;
}) {
  const queryClient = useQueryClient();
  const ingest = useServerFn(ingestManifest);
  const [manifestText, setManifestText] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [drafts, setDrafts] = useState<{ statement: string; category: string }[]>([]);
  const [draftStatement, setDraftStatement] = useState("");
  const [receipt, setReceipt] = useState<null | {
    manifestId: string;
    merkleRoot: string;
    pairingCode: string;
    claimCount: number;
    artifactCount: number;
    openAnomalies: number;
  }>(null);

  const mutation = useMutation({
    mutationFn: () =>
      ingest({ data: { manifest: JSON.parse(manifestText) as unknown, publicKeyPem: publicKey } }),
    onSuccess: (result) => {
      setReceipt(result);
      queryClient.invalidateQueries({ queryKey: ["organism"] });
      queryClient.invalidateQueries({ queryKey: ["my-organisms"] });
      toast.success("Manifest ingested and verified.");
      onConnected();
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · Describe the promise</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Draft concise claims first. The Observatory will ask for evidence for each one after you connect.
          </p>
          <Label htmlFor="draft-claim">Claim statement</Label>
          <Input
            id="draft-claim"
            placeholder="The platform runs without external network access."
            value={draftStatement}
            onChange={(event) => setDraftStatement(event.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={draftStatement.trim().length < 10}
            onClick={() => {
              setDrafts([...drafts, { statement: draftStatement.trim(), category: "core_functionality" }]);
              setDraftStatement("");
            }}
          >
            Add draft claim
          </Button>
          {drafts.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {drafts.map((draft, index) => (
                <li key={index}>{draft.statement}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2 · Connect the organism</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">Pair the Mesh Agent on your machine (nothing secret ever leaves it):</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
            {`node mesh/agent.mjs analyze ./your-project \\\n  --event ${eventId} \\\n  --project <project-id> --team ${teamName} \\\n  --submission ${submissionId}`}
          </pre>
          <Label htmlFor="manifest-json">Signed manifest JSON</Label>
          <Textarea
            id="manifest-json"
            rows={6}
            placeholder='Paste manifest.json here'
            value={manifestText}
            onChange={(event) => setManifestText(event.target.value)}
          />
          <Label htmlFor="agent-pubkey">Agent public key (PEM)</Label>
          <Textarea
            id="agent-pubkey"
            rows={4}
            placeholder="-----BEGIN PUBLIC KEY-----"
            value={publicKey}
            onChange={(event) => setPublicKey(event.target.value)}
          />
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            Verify and ingest
          </Button>
          {receipt && (
            <p className="font-mono text-xs text-muted-foreground">
              Ingested {receipt.claimCount} claims, {receipt.artifactCount} artifacts · pairing{" "}
              {receipt.pairingCode} · {receipt.openAnomalies} open anomalies
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OrganismWorkspace({
  organism,
  submissionId,
  eventId,
  isOrganizer,
}: {
  organism: LoadedOrganism;
  submissionId: string;
  eventId: string;
  isOrganizer: boolean;
}) {
  const [highContrast, setHighContrast] = useState(false);
  const manifest = organism.manifest.manifest as unknown as {
    projectId: string;
    astGraph?: { nodes: { id: string; kind: string; label: string; sourceRef: string; tags: string[] }[]; edges: { source: string; target: string; kind: string }[] };
  };
  const astGraph = manifest.astGraph ?? { nodes: [], edges: [] };
  const links = (organism.links as { claim_id: string; evidence_id: string; relationship: string }[]).map(
    (l) => ({ claimId: l.claim_id, evidenceId: l.evidence_id, relationship: l.relationship }),
  );

  const claims = organism.claims as { claim_id: string; status: string }[];
  const runs = organism.runs as { scenario_id: string; status: string }[];
  const latestFailed = new Map<string, string>();
  for (const run of runs) latestFailed.set(run.scenario_id, run.status);
  const failedScenarios = [...latestFailed.entries()].filter(([, status]) => status === "failed").map(([id]) => id);

  const requiredAcks = [
    ...claims
      .filter((c) => c.status === "CONTRADICTED")
      .map((c) => ({
        flag: `contradicted:${c.claim_id}`,
        label: `Claim "${c.claim_id}" is contradicted by stored evidence — I have reviewed the dispute.`,
      })),
    ...(failedScenarios.length > 0
      ? [
          { flag: "replay-failed", label: "A replay scenario failed — I have reviewed the run." },
          ...failedScenarios.map((scenario) => ({
            flag: `env-override:${scenario}`,
            label: `The "${scenario}" failure is environmental, not a product defect (only then may Technical Execution exceed 4/10).`,
          })),
        ]
      : []),
  ];

  const assessments = organism.assessments as {
    criterion: string;
    score: number;
    assessorLabel: string;
  }[];
  const means: Record<string, number> = {};
  for (const id of ["impact", "innovation", "technical_execution", "design", "presentation_evidence"]) {
    const values = assessments.filter((a) => a.criterion === id).map((a) => a.score);
    means[id] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 5;
  }
  const normalized: Record<string, number> = Object.fromEntries(
    Object.entries(means).map(([id, mean]) => [id, normalizedScore(mean)]),
  );
  const sensitivities = stressSensitivities({ normalized, baseWeights: WEIGHTS as Record<string, number> });

  return (
    <Tabs defaultValue="evidence">
      <TabsList aria-label="Observatory orbits">
        <TabsTrigger value="evidence">Evidence orbit</TabsTrigger>
        <TabsTrigger value="rubric">Rubric orbit</TabsTrigger>
        <TabsTrigger value="decision">Decision orbit</TabsTrigger>
      </TabsList>

      <TabsContent value="evidence" className="mt-6 space-y-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Evidence orbit</h2>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={highContrast}
              onChange={(event) => setHighContrast(event.target.checked)}
            />
            High contrast
          </label>
        </div>

        <Constellation nodes={astGraph.nodes} edges={astGraph.edges} links={links} highContrast={highContrast} />

        <ClaimsManager
          manifestId={organism.manifest.id}
          sealed={organism.manifest.sealed}
          claims={organism.claims as { claim_id: string; statement: string; category: string; status: string }[]}
          artifacts={
            organism.artifacts as { artifact_id: string; kind: string; content_hash: string; uri: string }[]
          }
        />

        <ReplayPanel manifestId={organism.manifest.id} sealed={organism.manifest.sealed} />

        <div>
          <h3 className="mb-3 text-lg font-semibold">Resolve anomalies</h3>
          <AnomaliesPanel
            anomalies={
              organism.anomalies as {
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
            canAct={!organism.manifest.sealed}
          />
        </div>
      </TabsContent>

      <TabsContent value="rubric" className="mt-6 space-y-6">
        <h2 className="text-xl font-semibold">Rubric orbit</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Fixed event weights — Impact 25%, Innovation 20%, Technical Execution 30%, Design 15%,
          Presentation &amp; Evidence 10%. Complexity raises the evidence bar, never the weights.
        </p>
        <AssessmentForm
          eventId={eventId}
          submissionId={submissionId}
          evidenceOptions={(organism.artifacts as { artifact_id: string; kind: string }[]).map((a) => ({
            id: a.artifact_id,
            kind: a.kind,
          }))}
          requiredAcks={requiredAcks}
        />
      </TabsContent>

      <TabsContent value="decision" className="mt-6 space-y-6">
        <h2 className="text-xl font-semibold">Decision orbit</h2>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stress-test the evaluation model</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {sensitivities.map((sensitivity) => (
                <li key={sensitivity.scenarioId}>{sensitivity.message}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Your own sensitivity only — never placement or competitor data.
            </p>
          </CardContent>
        </Card>

        <CertificatePanel certificate={organism.certificate} />

        <SealPanel
          manifestId={organism.manifest.id}
          sealed={organism.manifest.sealed}
          eventId={eventId}
          submissionId={submissionId}
          isOrganizer={isOrganizer}
          eligibility={organism.eligibility}
        />
      </TabsContent>
    </Tabs>
  );
}

function ClaimsManager({
  manifestId,
  sealed,
  claims,
  artifacts,
}: {
  manifestId: string;
  sealed: boolean;
  claims: { claim_id: string; statement: string; category: string; status: string }[];
  artifacts: { artifact_id: string; kind: string; content_hash: string; uri: string }[];
}) {
  const queryClient = useQueryClient();
  const create = useServerFn(createClaim);
  const link = useServerFn(addClaimLink);
  const [statement, setStatement] = useState("");
  const [linkForm, setLinkForm] = useState({ claimId: "", evidenceId: "", relationship: "SUPPORTS", explanation: "" });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["organism"] });

  const createMutation = useMutation({
    mutationFn: () =>
      create({ data: { manifestId, statement, category: "core_functionality", expectedEvidence: [] } }),
    onSuccess: () => {
      setStatement("");
      invalidate();
      toast.success("Claim added as UNVERIFIED.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const linkMutation = useMutation({
    mutationFn: () =>
      link({
        data: {
          manifestId,
          claimId: linkForm.claimId,
          evidenceId: linkForm.evidenceId,
          relationship: linkForm.relationship as "SUPPORTS" | "PARTIALLY_SUPPORTS" | "CONTRADICTS" | "CONTEXT",
          confidence: 0.8,
          explanation: linkForm.explanation,
        },
      }),
    onSuccess: () => {
      setLinkForm({ claimId: "", evidenceId: "", relationship: "SUPPORTS", explanation: "" });
      invalidate();
      toast.success("Evidence linked; claim status recomputed.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Claims ({claims.length})</h3>
      <ul className="space-y-2">
        {claims.map((claim) => (
          <li key={claim.claim_id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
            <Badge variant={claim.status === "SUPPORTED" ? "default" : claim.status === "CONTRADICTED" ? "destructive" : "secondary"}>
              {claim.status}
            </Badge>
            <span className="font-mono text-xs">{claim.claim_id}</span>
            <span className="text-muted-foreground">{claim.statement}</span>
          </li>
        ))}
      </ul>

      {!sealed && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Add a claim</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="new-claim">Statement</Label>
              <Input id="new-claim" value={statement} onChange={(e) => setStatement(e.target.value)} />
              <Button size="sm" disabled={statement.trim().length < 10 || createMutation.isPending} onClick={() => createMutation.mutate()}>
                Add claim
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Link evidence to a claim</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">
                  Claim
                  <select
                    className="mt-1 w-full rounded-md border bg-background p-2"
                    value={linkForm.claimId}
                    onChange={(e) => setLinkForm({ ...linkForm, claimId: e.target.value })}
                  >
                    <option value="">Pick…</option>
                    {claims.map((c) => (
                      <option key={c.claim_id} value={c.claim_id}>
                        {c.claim_id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  Artifact
                  <select
                    className="mt-1 w-full rounded-md border bg-background p-2"
                    value={linkForm.evidenceId}
                    onChange={(e) => setLinkForm({ ...linkForm, evidenceId: e.target.value })}
                  >
                    <option value="">Pick…</option>
                    {artifacts.map((a) => (
                      <option key={a.artifact_id} value={a.artifact_id}>
                        {a.artifact_id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">
                  Relationship
                  <select
                    className="mt-1 w-full rounded-md border bg-background p-2"
                    value={linkForm.relationship}
                    onChange={(e) => setLinkForm({ ...linkForm, relationship: e.target.value })}
                  >
                    {["SUPPORTS", "PARTIALLY_SUPPORTS", "CONTRADICTS", "CONTEXT"].map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Label htmlFor="link-expl">Explanation</Label>
              <Textarea
                id="link-expl"
                rows={2}
                value={linkForm.explanation}
                onChange={(e) => setLinkForm({ ...linkForm, explanation: e.target.value })}
              />
              <Button
                size="sm"
                disabled={!linkForm.claimId || !linkForm.evidenceId || linkForm.explanation.trim().length < 10 || linkMutation.isPending}
                onClick={() => linkMutation.mutate()}
              >
                Add link
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function ReplayPanel({ manifestId, sealed }: { manifestId: string; sealed: boolean }) {
  const queryClient = useQueryClient();
  const submit = useServerFn(submitReplayRun);
  const [reportText, setReportText] = useState("");
  const mutation = useMutation({
    mutationFn: () => submit({ data: { manifestId, report: JSON.parse(reportText) as never } }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["organism"] });
      toast.success(`Replay recorded (${result.runIds.length} scenario runs).`);
    },
    onError: (error) => toast.error((error as Error).message),
  });

  if (sealed) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Submit a replay report</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Run <span className="font-mono text-xs">node mesh/agent.mjs replay manifest.json</span> locally, then paste
          the signed report. Passing scenarios SUPPORT their claims; failing ones CONTRADICT them.
        </p>
        <Label htmlFor="replay-report">Signed replay report JSON</Label>
        <Textarea id="replay-report" rows={4} value={reportText} onChange={(e) => setReportText(e.target.value)} />
        <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          Verify and record
        </Button>
      </CardContent>
    </Card>
  );
}

function SealPanel({
  manifestId,
  sealed,
  eventId,
  submissionId,
  isOrganizer,
  eligibility,
}: {
  manifestId: string;
  sealed: boolean;
  eventId: string;
  submissionId: string;
  isOrganizer: boolean;
  eligibility: { status: string; reason: string };
}) {
  const queryClient = useQueryClient();
  const seal = useServerFn(sealOrganism);
  const decide = useServerFn(setEligibility);
  const [receipt, setReceipt] = useState<null | { receiptId: string; merkleRoot: string; claimCount: number; openAnomalies: number }>(null);
  const [status, setStatus] = useState("ELIGIBLE");
  const [reason, setReason] = useState("");

  const sealMutation = useMutation({
    mutationFn: () => seal({ data: { manifestId } }),
    onSuccess: (result) => {
      setReceipt(result);
      queryClient.invalidateQueries({ queryKey: ["organism"] });
      toast.success("Submission sealed. Receipt issued.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const eligibilityMutation = useMutation({
    mutationFn: () =>
      decide({ data: { eventId, submissionId, status: status as "ELIGIBLE" | "PROVISIONAL" | "INELIGIBLE" | "MANUAL_REVIEW_REQUIRED", reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organism"] });
      toast.success("Eligibility recorded.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Seal submission</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {sealed ? (
            <p className="text-muted-foreground">This submission is sealed and immutable.</p>
          ) : (
            <Button disabled={sealMutation.isPending} onClick={() => sealMutation.mutate()}>
              Seal and issue receipt
            </Button>
          )}
          {receipt && (
            <p className="font-mono text-xs text-muted-foreground">
              receipt {receipt.receiptId.slice(0, 16)}… · {receipt.claimCount} claims ·{" "}
              {receipt.openAnomalies} open anomalies · merkle {receipt.merkleRoot.slice(0, 12)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Sealing freezes claims, evidence, and runs. Current eligibility: {eligibility.status}
            {eligibility.reason ? ` — ${eligibility.reason}` : ""}.
          </p>
        </CardContent>
      </Card>

      {isOrganizer && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Eligibility (organizers)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <label className="text-xs">
              Status
              <select
                className="mt-1 w-full rounded-md border bg-background p-2"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {["ELIGIBLE", "PROVISIONAL", "INELIGIBLE", "MANUAL_REVIEW_REQUIRED"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <Label htmlFor="elig-reason">Reason</Label>
            <Textarea id="elig-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" disabled={eligibilityMutation.isPending} onClick={() => eligibilityMutation.mutate()}>
              Record decision
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
