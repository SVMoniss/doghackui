import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, useMatches } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listSubmissions } from "@/lib/hackathon.functions";

const projectsQuery = queryOptions({
  queryKey: ["projects"],
  queryFn: () => listSubmissions(),
});

export const Route = createFileRoute("/projects")({
  loader: ({ context }) => context.queryClient.ensureQueryData(projectsQuery),
  head: () => ({
    meta: [
      { title: "Submitted projects — OpenJudge" },
      {
        name: "description",
        content: "Every project submitted to the hackathon, with links to code, demos and videos.",
      },
      { property: "og:title", content: "Submitted projects — OpenJudge" },
      { property: "og:description", content: "Browse every hackathon submission." },
    ],
  }),
  errorComponent: () => (
    <div className="mx-auto max-w-6xl px-5 py-16 text-sm text-muted-foreground">
      Projects could not be loaded right now.
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-6xl px-5 py-16 text-sm text-muted-foreground">Not found.</div>
  ),
  component: Projects,
});

function Projects() {
  const { data: projects } = useSuspenseQuery(projectsQuery);
  const matches = useMatches();
  const isDetail = matches.some((m) => m.routeId === "/projects/$id");
  const [query, setQuery] = useState("");
  const [track, setTrack] = useState("");
  if (isDetail) return <Outlet />;

  const needle = query.trim().toLowerCase();
  const trackNames = [...new Set(projects.map((p) => (p as { tracks?: { name: string } | null }).tracks?.name ?? "No track"))].sort();
  const filtered = projects.filter((project) => {
    if (track && (project as { tracks?: { name: string } | null }).tracks?.name !== track && !(track === "No track" && !(project as { tracks?: { name: string } | null }).tracks?.name)) return false;
    if (needle.length === 0) return true;
    return [project.title, project.team_name, project.tagline ?? "", ...(project.tags ?? [])]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <h1 className="text-3xl font-bold tracking-tight">Submitted projects</h1>
      <p className="mt-2 text-muted-foreground">
        {projects.length} project{projects.length === 1 ? "" : "s"} in the running.
      </p>
      <div className="mt-6 flex max-w-xl flex-wrap gap-3">
        <Input
          type="search"
          aria-label="Search projects"
          placeholder="Search title, team, or tag…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-52 flex-1"
        />
        <select
          aria-label="Filter by track"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={track}
          onChange={(event) => setTrack(event.target.value)}
        >
          <option value="">All tracks</option>
          {trackNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-10 font-mono text-sm text-muted-foreground">
          {projects.length === 0 ? "Nothing submitted yet. Be the first." : "No projects match your search."}
        </p>
      ) : (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <Card key={project.id} className="flex flex-col overflow-hidden">
              {(project as { thumbnailUrl?: string | null }).thumbnailUrl && (
                <img
                  src={(project as { thumbnailUrl?: string | null }).thumbnailUrl!}
                  alt={`${project.title} thumbnail`}
                  className="h-36 w-full object-cover"
                  loading="lazy"
                />
              )}
              <CardHeader className="gap-1">
                <p className="font-mono text-xs uppercase tracking-widest text-primary">
                  {(project as { tracks?: { name: string } | null }).tracks?.name ?? "No track"}
                </p>
                <CardTitle className="text-lg">
                  <Link
                    to="/projects/$id"
                    params={{ id: project.id }}
                    className="hover:text-primary"
                  >
                    {project.title}
                  </Link>
                </CardTitle>
                <p className="font-mono text-xs text-muted-foreground">{project.team_name}</p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <p className="text-sm text-muted-foreground">{project.tagline}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(project.tags ?? []).map((tag) => (
                    <Badge key={tag} variant="secondary" className="font-mono text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
