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
import { Switch } from "@/components/ui/switch";
import {
  addJudge,
  applyReviewTargets,
  auditLog,
  decisionCertificate,
  exportAssignmentsCsv,
  exportReviewsCsv,
  freezeRubric,
  grantRole,
  leaderboard,
  listUsers,
  organizerDashboard,
  removeJudge,
  reviewTargets,
  revokeRole,
  rubricFreezeState,
  runAssignment,
  setJudgeScope,
  updateCriteria,
  updateEventSettings,
  type LeaderboardPayload,
} from "@/lib/organizer.functions";
import { claimFirstOrganizer } from "@/lib/participant.functions";
import { pairwiseRanking } from "@/lib/mesh/pairwise.functions";
import {
  createBallotTokens,
  listBallotTokens,
  revokeBallotToken,
  setVoting,
  standings,
  votingConfig,
} from "@/lib/mesh/community.functions";
import { createWebhook, deleteWebhook, listWebhooks } from "@/lib/organizer.functions";
import { EventsCard, PrizesCard, QuestionsCard } from "@/components/EventsCard";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Organizer dashboard — OpenJudge" },
      {
        name: "description",
        content:
          "Open or close submissions, manage judges, run balanced assignment, and compare raw versus normalized rankings.",
      },
      { property: "og:title", content: "Organizer dashboard — OpenJudge" },
      {
        property: "og:description",
        content: "Manage judges, assignment rounds, and normalized results.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const queryClient = useQueryClient();
  const fetchDashboard = useServerFn(organizerDashboard);
  const claim = useServerFn(claimFirstOrganizer);
  const [eventId, setEventId] = useState<string | null>(null);
  const dashboard = useQuery({
    queryKey: ["organizer-dashboard", eventId],
    queryFn: () => fetchDashboard({ data: { eventId: eventId ?? undefined } }),
    retry: false,
  });

  const claimMutation = useMutation({
    mutationFn: () => claim(),
    onSuccess: (result) => {
      if (result.granted) {
        toast.success("You are now an organizer");
        queryClient.invalidateQueries({ queryKey: ["organizer-dashboard"] });
      } else {
        toast.error(result.reason ?? "Could not claim the organizer role.");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (dashboard.isLoading) {
    return <p className="mx-auto max-w-6xl px-5 py-14 font-mono text-sm">Loading dashboard…</p>;
  }

  if (dashboard.error) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-14">
        <h1 className="text-3xl font-bold tracking-tight">Organizer dashboard</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {(dashboard.error as Error).message}
        </p>
        <p className="mt-6 text-sm text-muted-foreground">
          On a fresh self-hosted install the first signed-in account can claim the organizer role.
        </p>
        <Button
          className="mt-4"
          onClick={() => claimMutation.mutate()}
          disabled={claimMutation.isPending}
        >
          Claim organizer role
        </Button>
      </div>
    );
  }

  const data = dashboard.data;
  if (!data) {
    return (
      <p className="mx-auto max-w-6xl px-5 py-14 text-sm text-muted-foreground">
        No event exists yet.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-5 py-14">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{data.event.name}</h1>
        <p className="mt-2 font-mono text-sm text-muted-foreground">
          {data.submissions.length} projects · {data.judges.length} judges ·{" "}
          {data.assignments.length} assignments
        </p>
      </div>

      <EventSettings event={data.event} />
      <EventsCard selectedId={data.event.id} onSelect={(id) => setEventId(id)} />
      <PrizesCard eventId={data.event.id} />
      <QuestionsCard eventId={data.event.id} />
      <RubricCard eventId={data.event.id} criteria={data.criteria} />
      <DecisionConfidence eventId={data.event.id} />
      <Assignment eventId={data.event.id} />
      <Judges
        eventId={data.event.id}
        judges={data.judges}
        assignments={data.assignments}
        tracks={data.tracks}
        scopes={data.scopes}
      />
      <Governance eventId={data.event.id} />
      <AccessControl />
      <Voting eventId={data.event.id} />
      <Webhooks eventId={data.event.id} />
      <PairwiseRanking eventId={data.event.id} />
      <Exports eventId={data.event.id} />
      <Leaderboard eventId={data.event.id} />
    </div>
  );
}

type Dashboard = NonNullable<Awaited<ReturnType<typeof organizerDashboard>>>;

function EventSettings({ event }: { event: Dashboard["event"] }) {
  const queryClient = useQueryClient();
  const save = useServerFn(updateEventSettings);
  const [submissionsOpen, setSubmissionsOpen] = useState(event.submissions_open);
  const [judgingOpen, setJudgingOpen] = useState(event.judging_open);
  const [reviews, setReviews] = useState(String(event.reviews_per_submission));

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          eventId: event.id,
          submissionsOpen,
          judgingOpen,
          reviewsPerSubmission: Number(reviews),
        },
      }),
    onSuccess: () => {
      toast.success("Event settings saved");
      queryClient.invalidateQueries({ queryKey: ["organizer-dashboard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-8">
        <div className="flex items-center gap-3">
          <Switch
            id="submissions-open"
            checked={submissionsOpen}
            onCheckedChange={setSubmissionsOpen}
          />
          <Label htmlFor="submissions-open">Submissions open</Label>
        </div>
        <div className="flex items-center gap-3">
          <Switch id="judging-open" checked={judgingOpen} onCheckedChange={setJudgingOpen} />
          <Label htmlFor="judging-open">Judging open</Label>
        </div>
        <div className="space-y-2">
          <Label htmlFor="reviews">Reviews per project</Label>
          <Input
            id="reviews"
            type="number"
            min={1}
            max={20}
            value={reviews}
            onChange={(e) => setReviews(e.target.value)}
            className="max-w-24 font-mono"
          />
        </div>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          Save settings
        </Button>
      </CardContent>
    </Card>
  );
}

function Assignment({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const run = useServerFn(runAssignment);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runAssignment>> | null>(null);

  const mutation = useMutation({
    mutationFn: (dryRun: boolean) => run({ data: { eventId, dryRun } }),
    onSuccess: (payload) => {
      setResult(payload);
      toast.success(
        payload.dryRun
          ? `Preview: ${payload.created} assignments would be created`
          : `${payload.created} assignments created`,
      );
      queryClient.invalidateQueries({ queryKey: ["organizer-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Judge assignment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Balanced round-robin: every project gets the same number of reviews, workloads stay within
          one review of each other, and nobody reviews their own team or a declared conflict.
          Re-running only fills gaps.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => mutation.mutate(true)}
            disabled={mutation.isPending}
          >
            Preview round
          </Button>
          <Button onClick={() => mutation.mutate(false)} disabled={mutation.isPending}>
            Run assignment
          </Button>
        </div>
        {result ? (
          <div className="rounded-md border border-border p-4 font-mono text-xs">
            <p>created: {result.created}</p>
            <p>workload spread: {result.spread}</p>
            {result.shortfalls.length > 0 ? (
              <p className="text-destructive">
                shortfalls: {result.shortfalls.length} project(s) could not reach full coverage
              </p>
            ) : (
              <p>coverage: complete</p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Judges({
  eventId,
  judges,
  assignments,
  tracks,
  scopes,
}: {
  eventId: string;
  judges: Dashboard["judges"];
  assignments: Dashboard["assignments"];
  tracks: Dashboard["tracks"];
  scopes: Dashboard["scopes"];
}) {
  const queryClient = useQueryClient();
  const add = useServerFn(addJudge);
  const remove = useServerFn(removeJudge);
  const scope = useServerFn(setJudgeScope);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const addMutation = useMutation({
    mutationFn: () => add({ data: { eventId, displayName: name, email } }),
    onSuccess: (result) => {
      toast.success(result.linked ? "Judge added and linked to their account" : "Judge added");
      setName("");
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["organizer-dashboard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Judge removed");
      queryClient.invalidateQueries({ queryKey: ["organizer-dashboard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const scopeMutation = useMutation({
    mutationFn: (input: { judgeId: string; trackId: string | null }) =>
      scope({ data: { judgeId: input.judgeId, trackId: input.trackId } }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["organizer-dashboard"] });
      toast.success(
        variables.trackId ? "Judge scoped to track." : "Judge scope cleared (all tracks).",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Judges</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="judge-name">Name</Label>
            <Input id="judge-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="judge-email">Email (optional)</Label>
            <Input
              id="judge-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !name}>
            Add judge
          </Button>
        </div>

        <ul className="divide-y divide-border rounded-md border border-border">
          {judges.map((judge) => {
            const own = assignments.filter((a) => a.judge_id === judge.id);
            const done = own.filter((a) => a.status === "submitted").length;
            const scopeTrackId = scopes[judge.id] ?? null;
            const scopeTrack = tracks.find((t) => t.id === scopeTrackId)?.name ?? null;
            return (
              <li key={judge.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium">{judge.display_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {judge.email ?? "no email"} · {judge.user_id ? "account linked" : "not linked"} ·{" "}
                    {done}/{own.length} reviews submitted
                    {scopeTrack ? ` · track: ${scopeTrack}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label={`Track scope for ${judge.display_name}`}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={scopeTrackId ?? ""}
                    disabled={scopeMutation.isPending}
                    onChange={(event) =>
                      scopeMutation.mutate({
                        judgeId: judge.id,
                        trackId: event.target.value || null,
                      })
                    }
                  >
                    <option value="">All tracks</option>
                    {tracks.map((track) => (
                      <option key={track.id} value={track.id}>
                        {track.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => removeMutation.mutate(judge.id)}
                    disabled={removeMutation.isPending}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Rubric freeze ceremony plus the append-only audit trail: who changed
 * settings, judges, conflicts, assignments, eligibility, and reviews.
 */
function Governance({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const freeze = useServerFn(freezeRubric);
  const fetchFreeze = useServerFn(rubricFreezeState);
  const fetchAudit = useServerFn(auditLog);

  const frozen = useQuery({
    queryKey: ["rubric-freeze", eventId],
    queryFn: () => fetchFreeze({ data: { eventId } }),
  });
  const audit = useQuery({
    queryKey: ["audit-log", eventId],
    queryFn: () => fetchAudit({ data: { eventId, limit: 50 } }),
  });

  const freezeMutation = useMutation({
    mutationFn: () => freeze({ data: { eventId } }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["rubric-freeze"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
      toast.success(`Rubric frozen (${result.weightsHash.slice(0, 12)}…).`);
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Governance</CardTitle>
        {frozen.data?.frozen ? (
          <Badge variant="default">rubric frozen</Badge>
        ) : (
          <Button size="sm" variant="outline" disabled={freezeMutation.isPending} onClick={() => freezeMutation.mutate()}>
            Freeze rubric
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {frozen.data?.frozen && (
          <p className="font-mono text-xs text-muted-foreground">
            weights {frozen.data.weights_hash.slice(0, 20)}… ·{" "}
            {frozen.data.frozen_at ? new Date(frozen.data.frozen_at).toLocaleString() : ""}
          </p>
        )}
        <div>
          <h3 className="mb-2 text-sm font-medium">Audit trail (latest 50)</h3>
          {audit.isLoading ? (
            <p className="font-mono text-xs text-muted-foreground">Loading audit events…</p>
          ) : (audit.data ?? []).length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              No audit events yet — or the self-host database is unavailable.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
              {(audit.data ?? []).map((entry, index) => (
                <li key={index} className="flex flex-wrap gap-x-2 border-b border-border/50 py-1">
                  <span className="text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                  <span className="font-semibold">{entry.action}</span>
                  <span className="text-muted-foreground">
                    {entry.entity}
                    {entry.entity_id ? ` ${entry.entity_id.slice(0, 8)}` : ""} · by{" "}
                    {entry.actor.slice(0, 8)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Platform access control (admins only): user directory with grant/revoke.
 * Non-admin organizers never see this card — listUsers throws for them.
 */
function AccessControl() {
  const queryClient = useQueryClient();
  const fetchUsers = useServerFn(listUsers);
  const grant = useServerFn(grantRole);
  const revoke = useServerFn(revokeRole);
  const users = useQuery({ queryKey: ["users"], queryFn: () => fetchUsers(), retry: false });
  const [grants, setGrants] = useState<Record<string, string>>({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
    queryClient.invalidateQueries({ queryKey: ["audit-log"] });
  };

  const grantMutation = useMutation({
    mutationFn: (input: { userId: string; role: "organizer" | "judge" | "participant" | "admin" }) =>
      grant({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Role granted.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const revokeMutation = useMutation({
    mutationFn: (input: { userId: string; role: "organizer" | "judge" | "participant" | "admin" }) =>
      revoke({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Role revoked.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  if (users.error) return null;
  if (users.isLoading) {
    return <p className="font-mono text-xs text-muted-foreground">Loading access…</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access control</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border rounded-md border border-border">
          {(users.data ?? []).map((user) => (
            <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="font-medium">{user.email}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {user.roles.length === 0 && (
                    <span className="font-mono text-xs text-muted-foreground">no roles</span>
                  )}
                  {user.roles.map((role) => (
                    <span key={role} className="flex items-center gap-1">
                      <Badge variant="outline">{role}</Badge>
                      <button
                        type="button"
                        aria-label={`Revoke ${role} from ${user.email}`}
                        className="font-mono text-xs text-muted-foreground hover:text-destructive"
                        disabled={revokeMutation.isPending}
                        onClick={() =>
                          revokeMutation.mutate({
                            userId: user.id,
                            role: role as "organizer" | "judge" | "participant" | "admin",
                          })
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Grant role to ${user.email}`}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={grants[user.id] ?? ""}
                  onChange={(event) => setGrants({ ...grants, [user.id]: event.target.value })}
                >
                  <option value="">Grant…</option>
                  {["organizer", "judge", "participant", "admin"].map((role) => (
                    <option key={role} value={role} disabled={user.roles.includes(role)}>
                      {role}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!grants[user.id] || grantMutation.isPending}
                  onClick={() =>
                    grantMutation.mutate({
                      userId: user.id,
                      role: grants[user.id] as "organizer" | "judge" | "participant" | "admin",
                    })
                  }
                >
                  Grant
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Community voting controls: mode, window, publish gate, plus the live tally.
 * Results stay hidden from non-organizers until published.
 */
function Voting({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const fetchConfig = useServerFn(votingConfig);
  const save = useServerFn(setVoting);
  const fetchStandings = useServerFn(standings);
  const fetchTokens = useServerFn(listBallotTokens);
  const mint = useServerFn(createBallotTokens);
  const revoke = useServerFn(revokeBallotToken);
  const config = useQuery({ queryKey: ["voting", eventId], queryFn: () => fetchConfig({ data: { eventId } }) });
  const tally = useQuery({
    queryKey: ["standings", eventId],
    queryFn: () => fetchStandings({ data: { eventId } }),
  });
  const tokens = useQuery({
    queryKey: ["ballot-tokens", eventId],
    queryFn: () => fetchTokens({ data: { eventId } }),
  });
  const [mode, setMode] = useState("off");
  const [open, setOpen] = useState(false);
  const [published, setPublished] = useState(false);
  const [synced, setSynced] = useState(false);
  if (config.data && !synced) {
    setMode(config.data.mode);
    setOpen(config.data.open);
    setPublished(config.data.published);
    setSynced(true);
  }

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          eventId,
          mode: mode as "off" | "one_person_one_vote" | "quadratic",
          open,
          published,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voting"] });
      queryClient.invalidateQueries({ queryKey: ["standings"] });
      toast.success("Voting settings saved.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const [tokenCount, setTokenCount] = useState("10");
  const [freshTokens, setFreshTokens] = useState<string[]>([]);
  const mintMutation = useMutation({
    mutationFn: () => mint({ data: { eventId, count: Math.min(100, Math.max(1, Number(tokenCount) || 10)) } }),
    onSuccess: (result) => {
      setFreshTokens(result.tokens);
      queryClient.invalidateQueries({ queryKey: ["ballot-tokens"] });
      toast.success(`${result.tokens.length} ballot links created — copy them now.`);
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const revokeMutation = useMutation({
    mutationFn: (token: string) => revoke({ data: { token } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ballot-tokens"] });
      toast.success("Ballot link revoked.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Community voting</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-2 text-sm">
            Mode
            <select
              className="block h-9 rounded-md border border-input bg-background px-2"
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              <option value="off">Off</option>
              <option value="one_person_one_vote">One person, one vote</option>
              <option value="quadratic">Quadratic (up to 5 votes)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={open} onChange={(event) => setOpen(event.target.checked)} />
            Voting open
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={published}
              onChange={(event) => setPublished(event.target.checked)}
            />
            Results published
          </label>
          <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            Save voting
          </Button>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">Tally (organizers see it before publish)</h3>          {!tally.data || !tally.data.published || (tally.data.standings ?? []).length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              {(tally.data?.standings ?? []).length === 0 ? "No votes counted yet." : "Loading tally…"}
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {tally.data.standings.map((row) => (
                <li key={row.submissionId} className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{row.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.tally} ({row.ballots} ballots)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">Anonymous ballot links</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            Bearer links: whoever opens one may vote with no account. Distribute privately; revoke any time.
          </p>
          {freshTokens.length > 0 && (
            <ul className="mb-2 space-y-1 rounded-md bg-muted p-2 font-mono text-xs">
              {freshTokens.map((token) => (
                <li key={token} className="break-all">
                  /vote?t={token}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-24 space-y-2">
              <Label htmlFor="token-count">Count</Label>
              <Input
                id="token-count"
                type="number"
                min={1}
                max={100}
                value={tokenCount}
                onChange={(event) => setTokenCount(event.target.value)}
              />
            </div>
            <Button size="sm" disabled={mintMutation.isPending} onClick={() => mintMutation.mutate()}>
              Mint ballot links
            </Button>
          </div>
          <ul className="mt-2 space-y-1 text-xs">
            {(tokens.data ?? []).slice(0, 10).map((t) => (
              <li key={t.token} className="flex flex-wrap items-center gap-2 font-mono">
                <span className={t.revoked ? "text-muted-foreground line-through" : ""}>
                  {t.token.slice(0, 20)}… · {t.ballots} ballots{t.revoked ? " · revoked" : ""}
                </span>
                {!t.revoked && (
                  <Button size="sm" variant="ghost" onClick={() => revokeMutation.mutate(t.token)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Webhook subscriptions: HMAC-signed, best-effort delivery with a visible log.
 */
function Webhooks({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const fetchHooks = useServerFn(listWebhooks);
  const create = useServerFn(createWebhook);
  const remove = useServerFn(deleteWebhook);
  const hooks = useQuery({ queryKey: ["webhooks", eventId], queryFn: () => fetchHooks({ data: { eventId } }) });
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["webhooks", eventId] });
  const createMutation = useMutation({
    mutationFn: () => create({ data: { eventId, url, events: [] } }),
    onSuccess: (result) => {
      setSecret(result.secret);
      setUrl("");
      invalidate();
      toast.success("Webhook created — copy the secret now.");
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Webhook removed.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhooks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ul className="space-y-1">
          {(hooks.data ?? []).map((hook) => (
            <li key={hook.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs">
                {hook.url} · {hook.events.length === 0 ? "all events" : hook.events.join(", ")}
                {Number(hook.failures) > 0 && (
                  <span className="ml-2 text-destructive">{hook.failures} failed deliveries</span>
                )}
              </span>
              <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(hook.id)}>
                Remove
              </Button>
            </li>
          ))}
          {(hooks.data ?? []).length === 0 && (
            <li className="text-xs text-muted-foreground">No webhooks. Fires on submission, review, publish, eligibility.</li>
          )}
        </ul>
        {secret && (
          <p className="rounded-md bg-muted p-2 font-mono text-xs">
            Secret (shown once): {secret}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-52 flex-1 space-y-2">
            <Label htmlFor="webhook-url">Endpoint URL</Label>
            <Input
              id="webhook-url"
              placeholder="https://example.org/openjudge-hook"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <Button size="sm" disabled={!url.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
            Add webhook
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Pairwise ranking from explicit head-to-head votes (Bradley-Terry).
 * Compare against the rubric leaderboard to see if the ordering holds.
 */
function PairwiseRanking({ eventId }: { eventId: string }) {
  const fetchRanking = useServerFn(pairwiseRanking);
  const ranking = useQuery({
    queryKey: ["pairwise-ranking", eventId],
    queryFn: () => fetchRanking({ data: { eventId } }),
    retry: false,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pairwise ranking</CardTitle>
      </CardHeader>
      <CardContent>
        {ranking.isLoading ? (
          <p className="font-mono text-xs text-muted-foreground">Loading pairwise ranking…</p>
        ) : ranking.error ? (
          <p className="text-sm text-muted-foreground">{(ranking.error as Error).message}</p>
        ) : (ranking.data?.totalVotes ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            No head-to-head votes yet. Judges vote from the judging console.
          </p>
        ) : (
          <ol className="space-y-1 text-sm">
            {(ranking.data?.ranking ?? []).slice(0, 10).map((row) => (
              <li key={row.submissionId} className="flex items-baseline justify-between gap-3">
                <span>
                  <span className="mr-2 font-mono text-xs text-muted-foreground">#{row.rank}</span>
                  <span className="font-medium">{row.title}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{row.teamName}</span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {row.wins} wins · strength {row.strength}
                </span>
              </li>
            ))}
          </ol>
        )}
        {(ranking.data?.totalVotes ?? 0) > 0 && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {ranking.data?.totalVotes} head-to-head votes counted.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Weighted, organizer-configurable rubric. Blocked once frozen — the freeze
 * hash covers exactly these weights, so mid-event drift is impossible.
 */
function RubricCard({
  eventId,
  criteria,
}: {
  eventId: string;
  criteria: Dashboard["criteria"];
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(updateCriteria);
  const fetchFreeze = useServerFn(rubricFreezeState);
  const frozen = useQuery({
    queryKey: ["rubric-freeze", eventId],
    queryFn: () => fetchFreeze({ data: { eventId } }),
  });
  const [weights, setWeights] = useState<Record<string, string>>({});
  const isFrozen = frozen.data?.frozen === true;

  const current = (id: string, fallback: number) =>
    weights[id] ?? String(fallback);
  const sum = criteria.reduce((total, c) => total + Number(current(c.id, Number(c.weight))), 0);

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          eventId,
          criteria: criteria.map((c) => ({ id: c.id, weight: Number(current(c.id, Number(c.weight))) })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizer-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
      toast.success("Rubric weights saved.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Rubric</CardTitle>
        {isFrozen && <Badge variant="default">frozen</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {isFrozen && (
          <p className="text-xs text-muted-foreground">
            Frozen — weights cannot change mid-event. The freeze hash covers these values.
          </p>
        )}
        <ul className="space-y-2">
          {criteria.map((criterion) => (
            <li key={criterion.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">{criterion.name}</span>
                {criterion.description && (
                  <span className="ml-2 text-xs text-muted-foreground">{criterion.description}</span>
                )}
              </span>
              <Input
                aria-label={`Weight for ${criterion.name}`}
                type="number"
                min={0}
                max={10}
                step={0.05}
                className="w-24 font-mono"
                disabled={isFrozen || mutation.isPending}
                value={current(criterion.id, Number(criterion.weight))}
                onChange={(event) =>
                  setWeights({ ...weights, [criterion.id]: event.target.value })
                }
              />
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={isFrozen || mutation.isPending} onClick={() => mutation.mutate()}>
            Save weights
          </Button>
          <span className="font-mono text-xs text-muted-foreground">
            sum {sum.toFixed(2)} (must be 1.00)
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * CSV export at every stage: assignments, per-review scores (here), and the
 * results leaderboard (on the Leaderboard card).
 */
function Exports({ eventId }: { eventId: string }) {
  const fetchAssignments = useServerFn(exportAssignmentsCsv);
  const fetchReviews = useServerFn(exportReviewsCsv);

  function download(filename: string, csv: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  const [busy, setBusy] = useState<string | null>(null);
  async function exportStage(stage: "assignments" | "reviews") {
    setBusy(stage);
    try {
      const result =
        stage === "assignments"
          ? await fetchAssignments({ data: { eventId } })
          : await fetchReviews({ data: { eventId } });
      download(result.filename, result.csv);
      toast.success(`${result.filename} downloaded.`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exports</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => exportStage("assignments")}
        >
          {busy === "assignments" ? "Exporting…" : "Export assignments CSV"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => exportStage("reviews")}>
          {busy === "reviews" ? "Exporting…" : "Export reviews CSV"}
        </Button>
      </CardContent>
    </Card>
  );
}

function toCsv(payload: LeaderboardPayload) {  const header = [
    "rank_normalized",
    "rank_raw",
    "title",
    "team",
    "track",
    "reviews",
    "raw_total",
    "normalized_total",
    "flagged_low_reviews",
  ];
  const lines = payload.rows.map((row) =>
    [
      row.normalizedRank,
      row.rawRank,
      row.title,
      row.teamName,
      row.trackName ?? "",
      row.reviewCount,
      row.rawScore.toFixed(3),
      row.normalizedScore.toFixed(3),
      row.underReviewed ? "yes" : "no",
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function Leaderboard({ eventId }: { eventId: string }) {
  const fetchLeaderboard = useServerFn(leaderboard);
  const board = useQuery({
    queryKey: ["leaderboard", eventId],
    queryFn: () => fetchLeaderboard({ data: { eventId } }),
  });

  if (board.isLoading) {
    return <p className="font-mono text-sm">Loading results…</p>;
  }
  if (board.error) {
    return <p className="text-sm text-muted-foreground">{(board.error as Error).message}</p>;
  }
  const data = board.data;
  if (!data) return null;

  function download() {
    const blob = new Blob([toCsv(data!)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "openjudge-results.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Results — raw vs normalized</CardTitle>
        <Button size="sm" variant="outline" onClick={download} data-testid="export-csv">
          Export CSV
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">#</th>
                <th className="py-2 pr-4">Project</th>
                <th className="py-2 pr-4">Reviews</th>
                <th className="py-2 pr-4">Raw</th>
                <th className="py-2 pr-4">Normalized</th>
                <th className="py-2 pr-4">Raw rank</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.submissionId} className="border-t border-border">
                  <td className="py-2 pr-4 font-mono">{row.normalizedRank}</td>
                  <td className="py-2 pr-4">
                    <span className="font-medium">{row.title}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {row.teamName}
                    </span>
                    {row.underReviewed ? (
                      <Badge variant="destructive" className="ml-2">
                        under-reviewed
                      </Badge>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 font-mono">{row.reviewCount}</td>
                  <td className="py-2 pr-4 font-mono">{row.rawScore.toFixed(2)}</td>
                  <td className="py-2 pr-4 font-mono">{row.normalizedScore.toFixed(2)}</td>
                  <td className="py-2 pr-4 font-mono text-muted-foreground">{row.rawRank}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Judge calibration
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {data.judgeStats.map((stat) => (
              <li
                key={stat.judgeId}
                className="rounded-md border border-border px-4 py-2 font-mono text-xs"
              >
                {stat.judgeName}: mean {stat.mean.toFixed(2)} · sd {stat.stdDev.toFixed(2)} · bias{" "}
                {stat.bias > 0 ? "+" : ""}
                {stat.bias.toFixed(2)}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function DecisionConfidence({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const [prizePositions, setPrizePositions] = useState(3);
  const fetchCertificate = useServerFn(decisionCertificate);
  const fetchTargets = useServerFn(reviewTargets);
  const applyTargets = useServerFn(applyReviewTargets);

  const certificate = useQuery({
    queryKey: ["decision-certificate", eventId, prizePositions],
    queryFn: () => fetchCertificate({ data: { eventId, prizePositions } }),
  });
  const targets = useQuery({
    queryKey: ["review-targets", eventId, prizePositions],
    queryFn: () => fetchTargets({ data: { eventId, prizePositions, maxTargets: 8 } }),
  });

  const apply = useMutation({
    mutationFn: (pairs: { judgeId: string; submissionId: string }[]) =>
      applyTargets({ data: { eventId, pairs } }),
    onSuccess: (result) => {
      toast.success(`Queued ${result.created} decisive reviews`);
      queryClient.invalidateQueries({ queryKey: ["review-targets"] });
      queryClient.invalidateQueries({ queryKey: ["organizer-dashboard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cert = certificate.data?.certificate;
  const titles = certificate.data?.titles ?? {};
  const name = (id: string) => titles[id]?.title ?? "Project";

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Decision confidence</CardTitle>
        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="prize-positions" className="text-xs">
              Prizes
            </Label>
            <Input
              id="prize-positions"
              type="number"
              min={1}
              max={20}
              value={prizePositions}
              onChange={(event) => setPrizePositions(Number(event.target.value) || 1)}
              className="mt-1 w-20"
            />
          </div>
          {cert ? (
            <Badge variant={cert.overall === "ROBUST" ? "default" : "destructive"}>
              {cert.overall === "ROBUST" ? "Result holds up" : "Result is fragile"}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Every placing is recomputed four ways — plain average, judge-calibrated average, pairwise
          comparison, and rank-based voting. A place only counts as settled when all four agree.
        </p>

        {certificate.isLoading ? <p className="font-mono text-sm">Checking…</p> : null}
        {certificate.error ? (
          <p className="font-mono text-sm text-destructive">
            {(certificate.error as Error).message}
          </p>
        ) : null}

        {cert ? (
          <>
            <p className="font-mono text-sm">
              {cert.agreement.agreedPositions} of {cert.agreement.totalPositions} prize places are
              settled.
              {cert.disagreeingRules.length > 0
                ? ` Disagreement comes from: ${cert.disagreeingRules.join(", ")}.`
                : ""}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left font-mono text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Place</th>
                    <th className="py-2 pr-4">Verdict</th>
                    <th className="py-2 pr-4">Winner by every rule</th>
                    <th className="py-2">Still in contention</th>
                  </tr>
                </thead>
                <tbody>
                  {cert.positions.map((position) => (
                    <tr key={position.position} className="border-t border-border/60">
                      <td className="py-2 pr-4 font-mono">#{position.position}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={position.verdict === "ROBUST" ? "secondary" : "destructive"}>
                          {position.verdict === "ROBUST" ? "settled" : "too close"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        {position.consensus ? name(position.consensus) : "—"}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {position.contenders
                          .map((c) => `${name(c.submissionId)} (${c.rules.length}/4)`)
                          .join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="font-mono text-xs uppercase text-muted-foreground">
                Reviews that would settle it
              </h3>
              {targets.data && targets.data.targets.length > 0 ? (
                <>
                  <ul className="mt-3 space-y-2 text-sm">
                    {targets.data.targets.map((target) => (
                      <li
                        key={`${target.judgeId}-${target.submissionId}`}
                        className="flex flex-wrap items-baseline gap-2"
                      >
                        <span className="font-medium">{target.title}</span>
                        <span className="text-muted-foreground">→ {target.judgeName}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {target.reasons.join("; ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-4"
                    disabled={apply.isPending}
                    onClick={() =>
                      apply.mutate(
                        targets.data!.targets.map((t) => ({
                          judgeId: t.judgeId,
                          submissionId: t.submissionId,
                        })),
                      )
                    }
                  >
                    Queue these reviews
                  </Button>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing to add — no extra review would change a prize place.
                </p>
              )}
            </div>

            <div className="overflow-x-auto">
              <h3 className="font-mono text-xs uppercase text-muted-foreground">
                Per-project spread
              </h3>
              <table className="mt-3 w-full text-sm">
                <thead className="text-left font-mono text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Project</th>
                    <th className="py-2 pr-4">Reviews</th>
                    <th className="py-2 pr-4">Best–worst place</th>
                    <th className="py-2">Score range</th>
                  </tr>
                </thead>
                <tbody>
                  {cert.projects.slice(0, Math.max(prizePositions * 3, 8)).map((project) => (
                    <tr key={project.submissionId} className="border-t border-border/60">
                      <td className="py-2 pr-4">{name(project.submissionId)}</td>
                      <td className="py-2 pr-4 font-mono">
                        {project.reviewCount}
                        {project.underReviewed ? " ⚠" : ""}
                      </td>
                      <td className="py-2 pr-4 font-mono">
                        #{project.bestRank}–#{project.worstRank}
                      </td>
                      <td className="py-2 font-mono text-muted-foreground">
                        {project.interval.low.toFixed(2)} – {project.interval.high.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
