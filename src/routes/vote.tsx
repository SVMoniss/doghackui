import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEventOverview } from "@/lib/hackathon.functions";
import { ballot, castTokenVote, castVote, standings, tokenBallot } from "@/lib/mesh/community.functions";

export const Route = createFileRoute("/vote")({
  validateSearch: (search: Record<string, unknown>) => ({
    t: typeof search["t"] === "string" ? (search["t"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Community vote — OpenJudge" },
      {
        name: "description",
        content: "Community ballots with randomized ordering and hidden results until published.",
      },
    ],
  }),
  component: VotePage,
});

function VotePage() {
  const { t: tokenParam } = Route.useSearch();
  const queryClient = useQueryClient();
  const fetchOverview = useServerFn(getEventOverview);
  const fetchBallot = useServerFn(ballot);
  const vote = useServerFn(castVote);
  const fetchTokenBallot = useServerFn(tokenBallot);
  const voteByToken = useServerFn(castTokenVote);
  const fetchStandings = useServerFn(standings);
  const overview = useQuery({ queryKey: ["event-overview"], queryFn: () => fetchOverview() });
  const eventId = overview.data?.event.id ?? null;
  const [votes, setVotes] = useState<Record<string, number>>({});
  // Anonymous ballot links (?t=) work with no account; remembered locally.
  const [token] = useState<string | null>(() => {
    if (tokenParam) {
      try {
        localStorage.setItem("ballot-token", tokenParam);
      } catch {
        // Private mode: the link still works for this visit.
      }
      return tokenParam;
    }
    try {
      return localStorage.getItem("ballot-token");
    } catch {
      return null;
    }
  });

  const ballotQuery = useQuery({
    queryKey: ["ballot", eventId, token ?? "session"],
    queryFn: () =>
      token && eventId
        ? fetchTokenBallot({ data: { eventId, token } })
        : fetchBallot({ data: { eventId: eventId! } }),
    enabled: eventId !== null,
    retry: false,
  });
  const standingsQuery = useQuery({
    queryKey: ["standings", eventId],
    queryFn: () => fetchStandings({ data: { eventId: eventId! } }),
    enabled: eventId !== null,
    retry: false,
  });

  const voteMutation = useMutation({
    mutationFn: (input: { submissionId: string; votes: number }) =>
      token && eventId
        ? voteByToken({ data: { eventId, token, submissionId: input.submissionId, votes: input.votes } })
        : vote({ data: { eventId: eventId!, submissionId: input.submissionId, votes: input.votes } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ballot"] });
      queryClient.invalidateQueries({ queryKey: ["standings"] });
      toast.success("Vote counted.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  if (ballotQuery.error) {
    const message = (ballotQuery.error as Error).message;
    const needsToken = token && /token/i.test(message);
    return (
      <div className="mx-auto max-w-3xl px-5 py-14">
        <h1 className="text-3xl font-bold tracking-tight">Community vote</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {needsToken ? (
            <>This ballot link is invalid or revoked. Ask an organizer for a fresh one.</>
          ) : (
            <>
              {message} — <Link to="/auth" className="underline">sign in</Link> to vote, or open a
              ballot link from an organizer.
            </>
          )}
        </p>
        {token && !needsToken && (
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() => {
              try {
                localStorage.removeItem("ballot-token");
              } catch {
                // Ignore.
              }
              window.location.href = "/vote";
            }}
          >
            Forget this ballot link
          </Button>
        )}
      </div>
    );
  }

  const config = ballotQuery.data?.config;
  const projects = (ballotQuery.data?.projects ?? []) as {
    id: string;
    title: string;
    tagline: string | null;
    team_name: string;
  }[];
  const myVotes = (ballotQuery.data?.myVotes ?? {}) as Record<string, number>;
  const results = standingsQuery.data;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-5 py-14">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Community vote</h1>
        {token && (
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Voting with an anonymous ballot link — no account needed.
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          {!config || config.mode === "off" || !config.open
            ? "Community voting is currently closed."
            : `Ballot order is randomized per voter. Results stay hidden until organizers publish them.${
                config.mode === "quadratic" ? " Quadratic mode: spread up to 5 votes per project." : ""
              }`}
        </p>
      </div>

      {config && config.mode !== "off" && config.open && (
        <ul className="space-y-3">
          {projects.map((project) => (
            <li key={project.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
              <div>
                <Link to="/projects/$id" params={{ id: project.id }} className="font-medium hover:text-primary">
                  {project.title}
                </Link>
                <p className="font-mono text-xs text-muted-foreground">{project.team_name}</p>
                {myVotes[project.id] ? (
                  <Badge variant="secondary" className="mt-1">
                    you voted{config.mode === "quadratic" ? ` ${myVotes[project.id]}` : ""}
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {config.mode === "quadratic" && (
                  <select
                    aria-label={`Votes for ${project.title}`}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={votes[project.id] ?? 1}
                    onChange={(event) => setVotes({ ...votes, [project.id]: Number(event.target.value) })}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                )}
                <Button
                  size="sm"
                  disabled={voteMutation.isPending}
                  onClick={() => voteMutation.mutate({ submissionId: project.id, votes: votes[project.id] ?? 1 })}
                >
                  Vote
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Standings</CardTitle>
        </CardHeader>
        <CardContent>
          {!results || !results.published ? (
            <p className="text-sm text-muted-foreground">
              Results are hidden until organizers publish them.
            </p>
          ) : (results.standings ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No votes counted yet.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {(results.standings ?? []).map((row, index) => (
                <li key={row.submissionId} className="flex items-baseline justify-between gap-3">
                  <span>
                    <span className="mr-2 font-mono text-xs text-muted-foreground">#{index + 1}</span>
                    <span className="font-medium">{row.title}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.tally} ({row.ballots} ballots)
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
