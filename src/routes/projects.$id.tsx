import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getSubmission } from "@/lib/hackathon.functions";
import { hideComment, listComments, postComment } from "@/lib/mesh/community.functions";
import { myAccess } from "@/lib/participant.functions";

const projectQuery = (id: string) =>
  queryOptions({
    queryKey: ["project", id],
    queryFn: () => getSubmission({ data: { id } }),
  });

export const Route = createFileRoute("/projects/$id")({
  loader: async ({ context, params }) => {
    const project = await context.queryClient.ensureQueryData(projectQuery(params.id));
    if (!project) throw notFound();
    return project;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Project unavailable — OpenJudge" }, { name: "robots", content: "noindex" }],
      };
    }
    const title = `${loaderData.title} — OpenJudge`;
    const description = loaderData.tagline ?? `Hackathon project by ${loaderData.team_name}.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  errorComponent: () => (
    <div className="mx-auto max-w-3xl px-5 py-16 text-sm text-muted-foreground">
      This project could not be loaded.
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="text-2xl font-bold">Project not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        It may still be a draft, or it was withdrawn.
      </p>
      <Button className="mt-6" variant="outline" asChild>
        <Link to="/projects">Back to projects</Link>
      </Button>
    </div>
  ),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { id } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectQuery(id));
  if (!project) return null;

  const links = [
    { label: "Source code", href: project.repo_url },
    { label: "Live demo", href: project.demo_url },
    { label: "Video", href: project.video_url },
  ].filter((link) => Boolean(link.href));

  return (
    <article className="mx-auto max-w-3xl px-5 py-14">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
        {(project as { tracks?: { name: string } | null }).tracks?.name ?? "No track"}
      </p>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">{project.title}</h1>
      {(project as { media?: { thumbnail_url: string; images: string[] } }).media?.thumbnail_url && (
        <img
          src={(project as { media?: { thumbnail_url: string } }).media!.thumbnail_url}
          alt={`${project.title} thumbnail`}
          className="mt-6 max-h-72 w-full rounded-md border object-cover"
          loading="lazy"
        />
      )}
      <p className="mt-3 text-lg text-muted-foreground">{project.tagline}</p>
      <p className="mt-2 font-mono text-sm text-muted-foreground">Team {project.team_name}</p>

      <div className="mt-8 flex flex-wrap gap-2">
        {(project.tags ?? []).map((tag) => (
          <Badge key={tag} variant="secondary" className="font-mono text-xs">
            {tag}
          </Badge>
        ))}
      </div>

      <p className="mt-8 whitespace-pre-line leading-relaxed">{project.description}</p>

      {((project as { answers?: { questionId: string; label: string; value: string }[] }).answers ?? []).length > 0 && (
        <dl className="mt-8 space-y-3 rounded-md border p-4" aria-label="Organizer questions">
          {((project as { answers?: { questionId: string; label: string; value: string }[] }).answers ?? []).map(
            (answer) => (
              <div key={answer.questionId}>
                <dt className="text-sm font-medium">{answer.label}</dt>
                <dd className="text-sm text-muted-foreground">{answer.value}</dd>
              </div>
            ),
          )}
        </dl>
      )}

      {((project as { media?: { images: string[] } }).media?.images ?? []).length > 0 && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2" aria-label="Project image gallery">
          {((project as { media?: { images: string[] } }).media?.images ?? []).map((src) => (
            <img
              key={src}
              src={src}
              alt={`${project.title} screenshot`}
              className="max-h-56 w-full rounded-md border object-cover"
              loading="lazy"
            />
          ))}
        </div>
      )}

      {links.length > 0 && (
        <div className="mt-10 flex flex-wrap gap-3">
          {links.map((link) => (
            <Button key={link.label} variant="outline" asChild>
              <a href={link.href!} target="_blank" rel="noreferrer noopener">
                {link.label}
              </a>
            </Button>
          ))}
        </div>
      )}

      <Button variant="ghost" className="mt-12" asChild>
        <Link to="/projects">← All projects</Link>
      </Button>

      <CommentsThread submissionId={id} />
    </article>
  );
}

function CommentsThread({ submissionId }: { submissionId: string }) {
  const queryClient = useQueryClient();
  const fetchComments = useServerFn(listComments);
  const post = useServerFn(postComment);
  const hide = useServerFn(hideComment);
  const fetchAccess = useServerFn(myAccess);
  const comments = useQuery({
    queryKey: ["comments", submissionId],
    queryFn: () => fetchComments({ data: { submissionId } }),
  });
  const access = useQuery({ queryKey: ["my-access"], queryFn: () => fetchAccess(), retry: false });
  const [body, setBody] = useState("");
  const isOrganizer = (access.data?.roles ?? []).includes("organizer") || (access.data?.roles ?? []).includes("admin");

  const postMutation = useMutation({
    mutationFn: () => post({ data: { submissionId, body } }),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["comments", submissionId] });
      toast.success("Comment posted.");
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const hideMutation = useMutation({
    mutationFn: (commentId: string) => hide({ data: { commentId, hidden: true } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", submissionId] });
      toast.success("Comment hidden.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <section aria-label="Comments" className="mt-12 border-t border-border pt-8">
      <h2 className="text-xl font-semibold">Comments</h2>
      <ul className="mt-4 space-y-3">
        {(comments.data ?? []).map((comment) => (
          <li key={comment.id} className="rounded-md border p-3 text-sm">
            <p className="font-mono text-xs text-muted-foreground">
              {comment.author} · {new Date(comment.created_at).toLocaleString()}
            </p>
            <p className="mt-1">{comment.body}</p>
            {isOrganizer && (
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => hideMutation.mutate(comment.id)}>
                Hide
              </Button>
            )}
          </li>
        ))}
        {(comments.data ?? []).length === 0 && !comments.isLoading && (
          <li className="text-sm text-muted-foreground">No comments yet. Be the first.</li>
        )}
      </ul>
      <div className="mt-4 space-y-2">
        <Textarea
          aria-label="Write a comment"
          rows={3}
          placeholder={access.data ? "Write a comment…" : "Sign in to comment."}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={!access.data}
        />
        <Button size="sm" disabled={!body.trim() || postMutation.isPending || !access.data} onClick={() => postMutation.mutate()}>
          Post comment
        </Button>
      </div>
    </section>
  );
}
