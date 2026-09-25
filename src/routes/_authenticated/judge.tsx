import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { myQueue, saveReview } from "@/lib/judge.functions";
import { castPairwiseVote, pairwisePair } from "@/lib/mesh/pairwise.functions";

export const Route = createFileRoute("/_authenticated/judge")({
  head: () => ({
    meta: [
      { title: "Judging console — OpenJudge" },
      {
        name: "description",
        content: "Score the projects assigned to you across every criterion and submit reviews.",
      },
      { property: "og:title", content: "Judging console — OpenJudge" },
      { property: "og:description", content: "Score your assigned hackathon projects." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: JudgePage,
});

type QueueData = Awaited<ReturnType<typeof myQueue>>;
type Assignment = QueueData["assignments"][number];
type EvidenceStripData = {
  found: boolean;
  supported: number;
  partial: number;
  unverified: number;
  contradicted: number;
  replay: "passed" | "failed" | "none";
  signal: string;
};

/**
 * What the organism says before the judge scores: claim support counts,
 * replay outcome, and evidence signal — with a link to the full receipt.
 * Guidance only; the human still enters every score.
 */
function EvidenceStrip({
  strip,
  submissionId,
}: {
  strip: EvidenceStripData | null;
  submissionId: string;
}) {
  if (!strip?.found) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <Badge variant={strip.contradicted > 0 ? "destructive" : "secondary"}>
        {strip.supported} supported · {strip.partial} partial · {strip.unverified} unverified
        {strip.contradicted > 0 ? ` · ${strip.contradicted} contradicted` : ""}
      </Badge>
      <Badge variant={strip.replay === "failed" ? "destructive" : "outline"}>
        replay {strip.replay}
      </Badge>
      <Badge variant="outline">{strip.signal}</Badge>
      <Link
        to="/organisms/$submissionId"
        params={{ submissionId }}
        className="font-mono underline-offset-4 hover:underline"
      >
        View evidence receipt
      </Link>
    </div>
  );
}

function JudgePage() {
  const fetchQueue = useServerFn(myQueue);
  const queue = useQuery({ queryKey: ["judge-queue"], queryFn: () => fetchQueue() });
  const [activeId, setActiveId] = useState<string | null>(null);

  if (queue.isLoading) {
    return <p className="mx-auto max-w-5xl px-5 py-14 font-mono text-sm">Loading your queue…</p>;
  }

  if (queue.error) {
    return (
      <p className="mx-auto max-w-5xl px-5 py-14 text-sm text-muted-foreground">
        {(queue.error as Error).message}
      </p>
    );
  }

  const data = queue.data;
  if (!data || !data.judge || data.assignments.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-14">
        <h1 className="text-3xl font-bold tracking-tight">Judging console</h1>
        <p className="mt-3 text-muted-foreground">
          You have no assignments yet. An organizer needs to add you as a judge and run the
          assignment round.
        </p>
      </div>
    );
  }

  const done = data.assignments.filter((a) => a.status === "submitted").length;
  const active = data.assignments.find((a) => a.id === activeId) ?? null;

  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <h1 className="text-3xl font-bold tracking-tight">Judging console</h1>
      <p className="mt-2 font-mono text-sm text-muted-foreground">
        {data.judge.display_name} · {done} of {data.assignments.length} reviews submitted
      </p>

      <PairwiseDuel eventId={data.judge.event_id} />

      <div className="mt-9 grid gap-6 lg:grid-cols-[320px_1fr]">
        <ul className="space-y-2">
          {data.assignments.map((assignment) => (
            <li key={assignment.id}>
              <button
                onClick={() => setActiveId(assignment.id)}
                className={`w-full rounded-md border px-4 py-3 text-left transition-colors ${
                  activeId === assignment.id
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{assignment.submissions?.title}</span>
                  <span className="flex items-center gap-1">
                    {assignment.targeted && assignment.status !== "submitted" ? (
                      <Badge variant="destructive">decides a prize</Badge>
                    ) : null}
                    <Badge variant={assignment.status === "submitted" ? "default" : "secondary"}>
                      {assignment.status}
                    </Badge>
                  </span>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {assignment.submissions?.team_name}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {active ? (
          <ReviewForm
            key={active.id}
            assignment={active}
            criteria={data.criteria}
            evidence={data.evidence ?? {}}
          />
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Pick a project on the left to start reviewing.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * Pairwise mode: two projects, pick the better one. Votes feed a
 * Bradley-Terry ranking organizers can compare against rubric scores.
 */
function PairwiseDuel({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const fetchPair = useServerFn(pairwisePair);
  const vote = useServerFn(castPairwiseVote);
  const [round, setRound] = useState(0);
  const pair = useQuery({
    queryKey: ["pairwise-pair", eventId, round],
    queryFn: () => fetchPair({ data: { eventId } }),
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (input: { winnerId: string; loserId: string }) =>
      vote({ data: { eventId, winnerId: input.winnerId, loserId: input.loserId } }),
    onSuccess: () => {
      toast.success("Pairwise vote recorded.");
      setRound((r) => r + 1);
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const options = pair.data?.pair ?? [];
  if (pair.isLoading) {
    return <p className="mt-9 font-mono text-xs text-muted-foreground">Loading a head-to-head…</p>;
  }
  if (pair.error || options.length < 2) return null;
  const [a, b] = [options[0]!, options[1]!];

  return (
    <Card className="mt-9">
      <CardHeader>
        <CardTitle className="text-base">Head-to-head: which is better?</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {[
          { project: a, other: b },
          { project: b, other: a },
        ].map(({ project, other }) => (
          <div key={project.id} className="rounded-md border p-4">
            <p className="font-medium">{project.title}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{project.team_name}</p>
            {project.tagline && <p className="mt-2 text-sm text-muted-foreground">{project.tagline}</p>}
            <Button
              size="sm"
              className="mt-3"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ winnerId: project.id, loserId: other.id })}
            >
              {project.title} wins
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ReviewForm({
  assignment,
  criteria,
  evidence,
}: {
  assignment: Assignment;
  criteria: QueueData["criteria"];
  evidence: Record<string, EvidenceStripData>;
}) {
  const queryClient = useQueryClient();
  const submitReview = useServerFn(saveReview);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const submission = assignment.submissions;

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const score of assignment.scores) next[score.criterionId] = String(score.value);
    setScores(next);
    setComment(assignment.comment ?? "");
  }, [assignment]);

  const mutation = useMutation({
    mutationFn: (submit: boolean) =>
      submitReview({
        data: {
          assignmentId: assignment.id,
          submit,
          comment: comment || undefined,
          scores: criteria
            .filter((c) => scores[c.id] !== undefined && scores[c.id] !== "")
            .map((c) => ({ criterionId: c.id, value: Number(scores[c.id]) })),
        },
      }),
    onSuccess: (_result, submit) => {
      toast.success(submit ? "Review submitted" : "Draft saved");
      queryClient.invalidateQueries({ queryKey: ["judge-queue"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{submission?.title}</CardTitle>
        <p className="font-mono text-xs text-muted-foreground">{submission?.team_name}</p>
        <EvidenceStrip
          strip={evidence?.[assignment.submission_id] ?? null}
          submissionId={assignment.submission_id}
        />
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="whitespace-pre-line text-sm text-muted-foreground">
          {submission?.description}
        </p>

        <div className="flex flex-wrap gap-3">
          {[
            { label: "Repo", href: submission?.repo_url },
            { label: "Demo", href: submission?.demo_url },
            { label: "Video", href: submission?.video_url },
          ]
            .filter((link) => link.href)
            .map((link) => (
              <Button key={link.label} size="sm" variant="outline" asChild>
                <a href={link.href!} target="_blank" rel="noreferrer noopener">
                  {link.label}
                </a>
              </Button>
            ))}
        </div>

        <div className="space-y-5 border-t border-border pt-5">
          {criteria.map((criterion) => (
            <div key={criterion.id} className="space-y-2">
              <Label htmlFor={`score-${criterion.id}`}>
                {criterion.name}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  ({criterion.min_score}–{criterion.max_score}) · weight {criterion.weight}
                </span>
              </Label>
              {criterion.description ? (
                <p className="text-xs text-muted-foreground">{criterion.description}</p>
              ) : null}
              <Input
                id={`score-${criterion.id}`}
                type="number"
                min={criterion.min_score}
                max={criterion.max_score}
                value={scores[criterion.id] ?? ""}
                onChange={(e) => setScores((prev) => ({ ...prev, [criterion.id]: e.target.value }))}
                className="max-w-24 font-mono"
              />
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="overall">Overall feedback</Label>
          <Textarea
            id="overall"
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => mutation.mutate(false)}
            disabled={mutation.isPending}
          >
            Save draft
          </Button>
          <Button onClick={() => mutation.mutate(true)} disabled={mutation.isPending}>
            Submit review
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
