import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Client-only gate (ssr:false): the session cookie goes along automatically.
    const response = await fetch("/api/auth/me");
    const data = (await response.json().catch(() => null)) as { user: unknown } | null;
    if (!data?.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => <Outlet />,
});
