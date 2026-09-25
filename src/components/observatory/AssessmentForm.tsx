import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CRITERION_META, CRITERION_IDS, type CriterionId } from "@/lib/engine/scoring";
import { submitAssessments } from "@/lib/mesh/mesh.functions";

/**
 * Human judging form: five fixed criteria, 1–10 integers, confidence,
 * rationale, and evidence links. Machines guide; humans decide.
 */
export function AssessmentForm({
  eventId,
  submissionId,
  evidenceOptions,
  requiredAcks,
}: {
  eventId: string;
  submissionId: string;
  evidenceOptions: { id: string; kind: string }[];
  requiredAcks: { flag: string; label: string }[];
}) {
  const queryClient = useQueryClient();
  const submit = useServerFn(submitAssessments);
  const [scores, setScores] = useState<Record<CriterionId, number>>({
    impact: 5,
    innovation: 5,
    technical_execution: 5,
    design: 5,
    presentation_evidence: 5,
  });
  const [rationales, setRationales] = useState<Record<CriterionId, string>>({
    impact: "",
    innovation: "",
    technical_execution: "",
    design: "",
    presentation_evidence: "",
  });
  const [evidenceRefs, setEvidenceRefs] = useState<string[]>([]);
  const [acks, setAcks] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: () =>
      submit({
        data: {
          eventId,
          submissionId,
          assessments: CRITERION_IDS.map((criterion) => ({
            criterion,
            score: scores[criterion],
            confidence: 3,
            rationale: rationales[criterion],
            evidenceRefs,
            acknowledgedFlags: acks,
          })),
        },
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["organism"] });
      toast.success(`Assessment submitted. Project score: ${result.projectScore}`);
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const toggle = (list: string[], value: string, set: (next: string[]) => void) => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Criterion assessments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {CRITERION_IDS.map((criterion) => (
          <fieldset key={criterion} className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{CRITERION_META[criterion].label}</legend>
            <p className="text-xs text-muted-foreground">{CRITERION_META[criterion].question}</p>
            <div className="flex items-center gap-3">
              <Label htmlFor={`score-${criterion}`}>Score (1–10)</Label>
              <Input
                id={`score-${criterion}`}
                type="number"
                min={1}
                max={10}
                step={1}
                className="w-24"
                value={scores[criterion]}
                onChange={(event) =>
                  setScores({ ...scores, [criterion]: Number(event.target.value) })
                }
              />
            </div>
            <Label htmlFor={`rationale-${criterion}`}>Rationale</Label>
            <Textarea
              id={`rationale-${criterion}`}
              placeholder="Why this score? Reference specific evidence."
              value={rationales[criterion]}
              onChange={(event) => setRationales({ ...rationales, [criterion]: event.target.value })}
            />
          </fieldset>
        ))}

        {evidenceOptions.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Linked evidence</legend>
            {evidenceOptions.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={evidenceRefs.includes(option.id)}
                  onCheckedChange={() => toggle(evidenceRefs, option.id, setEvidenceRefs)}
                />
                <span className="font-mono text-xs">
                  {option.id} ({option.kind})
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {requiredAcks.length > 0 && (
          <fieldset className="space-y-2 rounded-md border border-destructive/40 p-3">
            <legend className="px-1 text-sm font-medium">Required acknowledgments</legend>
            {requiredAcks.map((ack) => (
              <label key={ack.flag} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={acks.includes(ack.flag)}
                  onCheckedChange={() => toggle(acks, ack.flag, setAcks)}
                />
                <span>{ack.label}</span>
              </label>
            ))}
          </fieldset>
        )}

        <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          Submit assessments
        </Button>
      </CardContent>
    </Card>
  );
}
