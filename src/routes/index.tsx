import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEventOverview } from "@/lib/hackathon.functions";

const overviewQuery = queryOptions({
  queryKey: ["event-overview"],
  queryFn: () => getEventOverview(),
});

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery),
  head: () => ({
    meta: [
      { title: "OpenJudge — run a hackathon you can host yourself" },
      {
        name: "description",
        content:
          "Collect project submissions, assign judges evenly, and rank teams on normalized scores. Open source and self-hostable with Docker Compose.",
      },
      { property: "og:title", content: "OpenJudge — self-hosted hackathon judging" },
      {
        property: "og:description",
        content:
          "Submissions, balanced judge assignment and score normalization in one self-hostable app.",
      },
    ],
  }),
  errorComponent: () => (
    <Shell>
      <p className="text-sm text-muted-foreground">The event could not be loaded right now.</p>
    </Shell>
  ),
  component: Home,
});

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-5 py-16">{children}</div>;
}

const dateFmt = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" }) : "TBC";

function Home() {
  const { data } = useSuspenseQuery(overviewQuery);

  if (!data) {
    return (
      <Shell>
        <h1 className="text-3xl font-bold">No event yet</h1>
        <p className="mt-3 max-w-lg text-muted-foreground">
          Sign in and claim the organizer seat to create your first event.
        </p>
        <Button className="mt-6" asChild>
          <Link to="/admin">Open the organizer area</Link>
        </Button>
      </Shell>
    );
  }

  const { event, tracks, criteria, submissionCount } = data;
  const prizes = (data as { prizes?: { id: string; position: number; title: string; amount: string }[] }).prizes ?? [];

  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
            {dateFmt(event.starts_at)} – {dateFmt(event.ends_at)}
          </p>
          <h1 className="mt-5 max-w-3xl text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            {event.name}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">{event.tagline}</p>
          <p className="mt-4 max-w-2xl text-muted-foreground">{event.description}</p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/submit">
                {event.submissions_open ? "Submit a project" : "Submissions closed"}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/projects">Browse {submissionCount} projects</Link>
            </Button>
          </div>

          <dl className="mt-12 grid gap-6 border-t border-border pt-8 font-mono text-sm sm:grid-cols-4">
            <Stat label="Projects" value={String(submissionCount)} />
            <Stat label="Reviews each" value={String(event.reviews_per_submission)} />
            <Stat label="Criteria" value={String(criteria.length)} />
            <Stat label="Judging" value={event.judging_open ? "open" : "closed"} />
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-bold tracking-tight">How judging works</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-sm uppercase tracking-widest text-primary">
                01 / Submit
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Teams enter their project once: title, description, repo, demo and video. Drafts stay
              private until submitted.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-sm uppercase tracking-widest text-primary">
                02 / Assign
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Every project gets {event.reviews_per_submission} independent reviews. Workloads stay
              within one review of each other, and conflicts of interest are skipped.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-sm uppercase tracking-widest text-primary">
                03 / Normalize
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Harsh and generous judges are corrected for before ranking, so no team is penalised
              for who happened to review them.
            </CardContent>
          </Card>
        </div>

        <div className="mt-14 grid gap-10 md:grid-cols-2">
          <div>
            <h3 className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Scoring criteria
            </h3>
            <ul className="mt-4 divide-y divide-border">
              {criteria.map((criterion) => (
                <li key={criterion.id} className="flex items-baseline justify-between gap-4 py-3">
                  <div>
                    <p className="font-medium">{criterion.name}</p>
                    <p className="text-sm text-muted-foreground">{criterion.description}</p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {criterion.min_score}–{criterion.max_score} · ×{Number(criterion.weight)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Tracks
            </h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {tracks.map((track) => (
                <Badge key={track.id} variant="secondary" className="font-mono text-xs">
                  {track.name}
                </Badge>
              ))}
            </div>
            {prizes.length > 0 && (
              <>
                <h3 className="mt-8 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  Prizes
                </h3>
                <ul className="mt-4 space-y-2">
                  {prizes.map((prize) => (
                    <li key={prize.id} className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="font-medium">
                        {prize.position}. {prize.title}
                      </span>
                      {prize.amount && (
                        <span className="font-mono text-xs text-muted-foreground">{prize.amount}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-bold text-foreground">{value}</dd>
    </div>
  );
}
