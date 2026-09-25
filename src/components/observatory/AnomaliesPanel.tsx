import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { resolveAnomaly } from "@/lib/mesh/mesh.functions";

export type AnomalyRow = {
  id: string;
  anomaly_key: string;
  severity: string;
  category: string;
  finding: string;
  confidence: number | string;
  evidence_refs: string[];
  allowed_actions: string[];
  state: string;
  resolution: string | null;
};

const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  INFO: "outline",
  LOW: "secondary",
  MEDIUM: "default",
  HIGH: "destructive",
  CRITICAL: "destructive",
};

/**
 * Contestable findings: every anomaly names its evidence and offers explicit
 * actions. Nothing here deducts score; resolutions are stored with rationale.
 */
export function AnomaliesPanel({ anomalies, canAct }: { anomalies: AnomalyRow[]; canAct: boolean }) {
  const queryClient = useQueryClient();
  const resolve = useServerFn(resolveAnomaly);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: (input: { anomalyId: string; action: "EXPLAIN" | "ATTACH_EVIDENCE" | "WAIVE" | "RETRY"; note: string }) =>
      resolve({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organism"] });
      toast.success("Anomaly updated.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  if (anomalies.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          No anomalies. The evidence graph is quiet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {anomalies.map((anomaly) => (
        <Card key={anomaly.id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={SEVERITY_VARIANT[anomaly.severity] ?? "outline"}>{anomaly.severity}</Badge>
              <Badge variant="outline">{anomaly.category}</Badge>
              <Badge variant={anomaly.state === "open" ? "secondary" : "default"}>{anomaly.state}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{anomaly.finding}</p>
            <p className="font-mono text-xs text-muted-foreground">
              confidence {Number(anomaly.confidence).toFixed(2)}
              {anomaly.evidence_refs.length > 0 ? ` · evidence: ${anomaly.evidence_refs.join(", ")}` : ""}
            </p>
            {anomaly.resolution && (
              <p className="text-xs text-muted-foreground">Resolution: {anomaly.resolution}</p>
            )}
            {canAct && anomaly.state === "open" && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Input
                  className="min-w-52 flex-1"
                  placeholder="Rationale (required for waive/explain)"
                  aria-label={`Rationale for ${anomaly.anomaly_key}`}
                  value={notes[anomaly.id] ?? ""}
                  onChange={(event) => setNotes({ ...notes, [anomaly.id]: event.target.value })}
                />
                {anomaly.allowed_actions.map((action) => (
                  <Button
                    key={action}
                    size="sm"
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        anomalyId: anomaly.id,
                        action: action as "EXPLAIN" | "ATTACH_EVIDENCE" | "WAIVE" | "RETRY",
                        note: notes[anomaly.id] ?? "",
                      })
                    }
                  >
                    {action}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
