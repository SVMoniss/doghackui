import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { fetchMe, type AuthUser } from "@/lib/auth/client";

/** Local session state, refreshed on every navigation (the header persists across SPA navigations). */
export function useSession() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    setLoading(true);
    fetchMe()
      .then(({ user }) => {
        setUser(user);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [pathname]);

  return { session: user ? { user } : null, loading, user, refresh: () => fetchMe().then(({ user }) => setUser(user)) };
}
