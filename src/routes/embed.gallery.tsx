import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { listSubmissions } from "@/lib/hackathon.functions";

export const Route = createFileRoute("/embed/gallery")({
  head: () => ({
    meta: [
      { title: "Projects — OpenJudge embed" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EmbedGallery,
});

/**
 * Embeddable project gallery: a chrome-free page designed for
 * `<iframe src="<origin>/embed/gallery" width="100%" height="600">`.
 */
function EmbedGallery() {
  const fetchProjects = useServerFn(listSubmissions);
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => fetchProjects() });

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, maxWidth: 900 }}>
      <p style={{ fontSize: 12, opacity: 0.6 }}>Powered by OpenJudge</p>
      {projects.isLoading && <p>Loading projects…</p>}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", marginTop: 12 }}>
        {(projects.data ?? []).map((project) => (
          <a
            key={project.id}
            href={`/projects/${project.id}`}
            target="_blank"
            rel="noreferrer"
            style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12, textDecoration: "none", color: "inherit" }}
          >
            <strong>{project.title}</strong>
            <br />
            <small style={{ opacity: 0.7 }}>{project.team_name}</small>
            {project.tagline && (
              <>
                <br />
                <small>{project.tagline}</small>
              </>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
