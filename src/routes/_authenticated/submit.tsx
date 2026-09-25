import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getEventOverview } from "@/lib/hackathon.functions";
import {
  deleteProject,
  myProjects,
  saveProject,
  saveSubmissionAnswers,
  saveSubmissionMedia,
} from "@/lib/participant.functions";
import { listQuestions } from "@/lib/organizer.functions";
import { TeamsCard } from "@/components/TeamsCard";
import {
  buildSubmissionInput,
  submissionWindowStatus,
  type SubmitFormState,
} from "@/lib/submit-payload";

export const Route = createFileRoute("/_authenticated/submit")({
  head: () => ({
    meta: [
      { title: "Submit your project — OpenJudge" },
      {
        name: "description",
        content: "Enter your hackathon project details and submit it for judging.",
      },
      { property: "og:title", content: "Submit your project — OpenJudge" },
      { property: "og:description", content: "Enter your project details and submit for judging." },
    ],
  }),
  component: SubmitPage,
});

const empty: SubmitFormState = {
  title: "",
  teamName: "",
  tagline: "",
  description: "",
  repoUrl: "",
  demoUrl: "",
  videoUrl: "",
  thumbnailUrl: "",
  images: "",
  trackId: "",
  tags: "",
  answers: {},
};

function SubmitPage() {
  const queryClient = useQueryClient();
  const fetchMine = useServerFn(myProjects);
  const fetchOverview = useServerFn(getEventOverview);
  const fetchQuestions = useServerFn(listQuestions);
  const save = useServerFn(saveProject);
  const saveMedia = useServerFn(saveSubmissionMedia);
  const saveAnswers = useServerFn(saveSubmissionAnswers);
  const remove = useServerFn(deleteProject);

  const mine = useQuery({ queryKey: ["my-projects"], queryFn: () => fetchMine() });
  const overview = useQuery({ queryKey: ["event-overview"], queryFn: () => fetchOverview() });
  const eventId = overview.data?.event.id ?? null;
  const questions = useQuery({
    queryKey: ["questions", eventId],
    queryFn: () => fetchQuestions({ data: { eventId: eventId! } }),
    enabled: eventId !== null,
  });
  const [form, setForm] = useState<SubmitFormState>(empty);

  const saveMutation = useMutation({
    mutationFn: async (input: { status: "draft" | "submitted" }) => {
      if (!eventId) throw new Error("Event not loaded yet — please wait and retry.");
      const saved = await save({ data: buildSubmissionInput(form, eventId, input.status) });
      // Custom answers: validate required ones on submit, persist what's given.
      const entries = Object.entries(form.answers).filter(([, value]) => value.trim());
      if (entries.length > 0 || input.status === "submitted") {
        await saveAnswers({
          data: {
            submissionId: saved.id,
            forSubmit: input.status === "submitted",
            answers: entries.map(([questionId, value]) => ({ questionId, value })),
          },
        });
      }
      // Media is optional: only overwrite when the team provided something.
      if (form.thumbnailUrl.trim() || form.images.trim()) {
        await saveMedia({
          data: {
            submissionId: saved.id,
            thumbnailUrl: form.thumbnailUrl.trim(),
            images: form.images
              .split(",")
              .map((url) => url.trim())
              .filter(Boolean),
          },
        });
      }
      return saved;
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.status === "submitted" ? "Project submitted" : "Draft saved");
      setForm(empty);
      queryClient.invalidateQueries({ queryKey: ["my-projects"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["event-overview"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Project deleted");
      queryClient.invalidateQueries({ queryKey: ["my-projects"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const set = (key: keyof SubmitFormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const window = submissionWindowStatus(
    overview.data?.event
      ? {
          submissions_open: overview.data.event.submissions_open,
          ends_at: overview.data.event.ends_at,
        }
      : null,
  );

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <h1 className="text-3xl font-bold tracking-tight">Your projects</h1>
      <p className="mt-2 text-muted-foreground">
        {!overview.data
          ? "Loading the submission window…"
          : window.submitsAllowed
            ? "Save a draft as you go, then submit it before the deadline."
            : window.reason}
      </p>

      <div className="mt-8 space-y-3">
        {(mine.data ?? []).map((project) => (
          <Card key={project.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <div>
                <p className="font-medium">{project.title}</p>
                <p className="font-mono text-xs text-muted-foreground">{project.team_name}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={project.status === "submitted" ? "default" : "secondary"}>
                  {project.status}
                </Badge>
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/receipt/$projectId" params={{ projectId: project.id }}>
                    Judging receipt
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setForm({
                      id: project.id,
                      title: project.title,
                      teamName: project.team_name,
                      tagline: project.tagline ?? "",
                      description: project.description ?? "",
                      repoUrl: project.repo_url ?? "",
                      demoUrl: project.demo_url ?? "",
                      videoUrl: project.video_url ?? "",
                      thumbnailUrl: "",
                      images: "",
                      trackId: project.track_id ?? "",
                      tags: (project.tags ?? []).join(", "),
                      answers: {},
                    })
                  }
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => deleteMutation.mutate(project.id)}
                  disabled={project.status === "submitted"}
                >
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <TeamsCard eventId={overview.data?.event.id ?? null} />

      <Card className="mt-10">
        <CardHeader>
          <CardTitle>{form.id ? "Edit project" : "New project"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Project title" value={form.title} onChange={set("title")} />
          <Field label="Team name" value={form.teamName} onChange={set("teamName")} />
          <Field label="One-line summary" value={form.tagline} onChange={set("tagline")} />
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={6}
              value={form.description}
              onChange={(e) => set("description")(e.target.value)}
            />
          </div>
          <Field label="Repository URL" value={form.repoUrl} onChange={set("repoUrl")} />
          <Field label="Live demo URL" value={form.demoUrl} onChange={set("demoUrl")} />
          <Field label="Video URL" value={form.videoUrl} onChange={set("videoUrl")} />
          <Field label="Thumbnail URL" value={form.thumbnailUrl} onChange={set("thumbnailUrl")} />
          <Field
            label="Image gallery URLs (comma separated)"
            value={form.images}
            onChange={set("images")}
          />
          <div className="space-y-2">
            <Label htmlFor="track">Track</Label>
            <select
              id="track"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.trackId}
              onChange={(e) => set("trackId")(e.target.value)}
            >
              <option value="">No track</option>
              {(overview.data?.tracks ?? []).map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Tags (comma separated)"
            value={form.tags}
            onChange={set("tags")}
          />
          {(questions.data ?? []).map((question) => (
            <div className="space-y-2" key={question.id}>
              <Label htmlFor={`question-${question.id}`}>
                {question.label}
                {question.required && <span className="ml-1 text-destructive">*</span>}
              </Label>
              {question.kind === "boolean" ? (
                <select
                  id={`question-${question.id}`}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.answers[question.id] ?? ""}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      answers: { ...prev.answers, [question.id]: event.target.value },
                    }))
                  }
                >
                  <option value="">Pick…</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <Input
                  id={`question-${question.id}`}
                  type={question.kind === "number" ? "number" : question.kind === "url" ? "url" : "text"}
                  value={form.answers[question.id] ?? ""}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      answers: { ...prev.answers, [question.id]: event.target.value },
                    }))
                  }
                />
              )}
            </div>
          ))}

          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => saveMutation.mutate({ status: "draft" })}
              disabled={saveMutation.isPending || !window.savesAllowed}
            >
              Save draft
            </Button>
            <Button
              onClick={() => saveMutation.mutate({ status: "submitted" })}
              disabled={saveMutation.isPending || !window.submitsAllowed}
            >
              Submit for judging
            </Button>
            {form.id && (
              <Button variant="ghost" onClick={() => setForm(empty)}>
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `submit-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
