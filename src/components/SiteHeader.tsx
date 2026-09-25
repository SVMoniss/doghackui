import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { signOut } from "@/lib/auth/client";

const links = [
  { to: "/", label: "Event" },
  { to: "/projects", label: "Projects" },
  { to: "/vote", label: "Vote" },
  { to: "/observatory", label: "Observatory" },
  { to: "/judge", label: "Judging" },
  { to: "/admin", label: "Organizers" },
] as const;

export function SiteHeader() {
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="border-b border-border bg-surface/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <Link to="/" className="font-mono text-sm font-bold tracking-tight text-primary">
          openjudge<span className="text-muted-foreground">/</span>
        </Link>

        <nav className="flex flex-wrap items-center gap-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              activeProps={{ className: "text-primary" }}
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {loading ? null : session ? (
            <>
              <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                {session.user.email}
              </span>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                Sign out
              </Button>
            </>
          ) : (
            <Button size="sm" asChild>
              <Link to="/auth">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
