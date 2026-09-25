import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { projectReceipt } from "@/lib/participant.functions";

export const Route = createFileRoute("/_authenticated/receipt/$projectId")({
  head: () => ({
    meta: [
      { title: "Judging receipt — OpenJudge" },
      {
        name: "description",
        content:
          "See every score behind your project's placing: each judge's numbers, how harsh they were, and how the result holds up under four different ways of counting.",
      },
      { property: "og:title", content: "Judging receipt — OpenJudge" },
      {
        property: "og:description",
        content: "The full, contestable record behind one project's placing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReceiptPage,
});

const num = (value: number, digits = 2) => value.toFixed(digits);

function ReceiptPage() {
  const { projectId } = Route.useParams();
  const fetchReceipt = useServerFn(projectReceipt);
  const receipt = useQuery({
    queryKey: ["project-receipt", projectId],
    queryFn: () => fetchReceipt({ data: { submissionId: projectId } }),
    retry: false,
  });

  if (receipt.isLoading) {
    return <p className="mx-auto max-w-4xl px-5 py-14 font-mono text-sm">Building your receipt…</p>;
  }

  if (receipt.error) {
    return (
      <p className="mx-auto max-w-4xl px-5 py-14 text-sm text-muted-foreground">
        {(receipt.error as Error).message}
      </p>
    );
  }

  const data = receipt.data;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-5 py-14">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Judging receipt
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{data.submission.title}</h1>
        <p className="mt-2 font-mono text-sm text-muted-foreground">
          {data.submission.team_name} ·{" "}
          <Link to="/projects/$id" params={{ id: data.submission.id }} className="underline">
            view the project page
          </Link>
        </p>
      </div>

      {!data.published ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No reviews have been submitted for this project yet, so there is nothing to show. The
            receipt appears as soon as judging starts.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>Where you placed</CardTitle>
              <Badge variant={data.certificate.overall === "ROBUST" ? "default" : "destructive"}>
                {data.certificate.overall === "ROBUST"
                  ? "Prize places settled"
                  : "Some prize places too close to call"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Your place was worked out four different ways. If they all give the same answer, the
                result does not depend on the method.
              </p>
              <table className="w-full text-sm">
                <tbody>
                  {data.certificate.rules.map((rule) => (
                    <tr key={rule.rule} className="border-t border-border/60">
                      <td className="py-2 pr-4">{rule.label}</td>
                      <td className="py-2 font-mono">
                        {rule.rank ? `#${rule.rank}` : "not ranked"} of {data.projectCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="font-mono text-sm">
                Best case #{data.project.bestRank} · worst case #{data.project.worstRank} · score
                range {num(data.project.interval.low)} – {num(data.project.interval.high)} (middle{" "}
                {num(data.project.interval.median)})
              </p>
              {data.project.underReviewed ? (
                <p className="text-sm text-destructive">
                  This project has fewer reviews than the event requires — that alone widens the
                  range above.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Every score you were given</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Judges are anonymous, but their scoring habits are not. "Runs harsh/generous" is how
                far that judge's average sits from the event average of{" "}
                {num(data.overallMean)}; the adjusted ranking corrects for it.
              </p>
              {data.reviews.map((review) => (
                <div key={review.judgeLabel} className="rounded-md border border-border/60 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{review.judgeLabel}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      total {num(review.rawTotal)} · their average {num(review.judgeMean)} across{" "}
                      {review.judgeReviewCount} projects ·{" "}
                      {review.judgeBias < -0.1
                        ? `runs harsh by ${num(Math.abs(review.judgeBias))}`
                        : review.judgeBias > 0.1
                          ? `runs generous by ${num(review.judgeBias)}`
                          : "scores around average"}
                    </span>
                  </div>
                  <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
                    {review.perCriterion.map((criterion) => (
                      <li key={criterion.name} className="flex justify-between gap-3">
                        <span className="text-muted-foreground">{criterion.name}</span>
                        <span className="font-mono">{criterion.value ?? "—"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Disagree with something here?</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Point the organizers at one line of this receipt — a specific score, a missing review,
              or a judge who should never have seen your project. Every number above traces back to
              a single review, so a dispute can be checked and, if it was wrong, corrected and
              recomputed.
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
