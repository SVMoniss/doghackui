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

export type CertificateData = {
  scoreVersion: string;
  eligibilityStatus: string;
  methods: Record<string, { rank: number | null; score: number | null }>;
  prizeBoundary: {
    boundary: string;
    verdict: "ROBUST" | "FRAGILE";
    agreeingMethods: string[];
    disagreeingMethods: string[];
    contenders: string[];
    explanation: string;
  };
  evidenceSummary: {
    sufficiency: number;
    signal: string;
    verifiedClaims: number;
    partialClaims: number;
    contradictedClaims: number;
  };
};

const METHOD_LABELS: Record<string, string> = {
  rawAverage: "Raw average",
  calibrated: "Judge-calibrated average",
  bradleyTerry: "Pairwise (Bradley-Terry)",
  borda: "Rank-based (Borda)",
};

/**
 * The contestable decision certificate: every prize boundary recomputed
 * under four rules, with disagreement explained in plain language.
 */
export function CertificatePanel({ certificate }: { certificate: CertificateData }) {
  const robust = certificate.prizeBoundary.verdict === "ROBUST";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Decision certificate
          <Badge variant={robust ? "default" : "destructive"}>
            {certificate.prizeBoundary.verdict}
          </Badge>
          <Badge variant="outline">{certificate.eligibilityStatus}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>{certificate.prizeBoundary.explanation}</p>

        <Table aria-label="Placement under each ranking rule">
          <TableHeader>
            <TableRow>
              <TableHead>Ranking rule</TableHead>
              <TableHead>Rank</TableHead>
              <TableHead>Rule score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(certificate.methods).map(([rule, placement]) => (
              <TableRow key={rule}>
                <TableCell>{METHOD_LABELS[rule] ?? rule}</TableCell>
                <TableCell>{placement.rank ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">
                  {placement.score === null ? "—" : placement.score.toFixed(3)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="font-mono text-xs text-muted-foreground">Boundary</dt>
            <dd>{certificate.prizeBoundary.boundary}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-muted-foreground">Score version</dt>
            <dd>{certificate.scoreVersion} (fixed event weights)</dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-muted-foreground">Evidence sufficiency</dt>
            <dd>
              {certificate.evidenceSummary.sufficiency.toFixed(2)} · {certificate.evidenceSummary.signal}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-muted-foreground">Claims</dt>
            <dd>
              {certificate.evidenceSummary.verifiedClaims} verified ·{" "}
              {certificate.evidenceSummary.partialClaims} partial ·{" "}
              {certificate.evidenceSummary.contradictedClaims} contradicted
            </dd>
          </div>
        </dl>

        {certificate.prizeBoundary.contenders.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Still in contention: {certificate.prizeBoundary.contenders.join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
