import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { acceptInvite } from "@/lib/mesh/team.functions";

export const Route = createFileRoute("/_authenticated/team/$token")({
  head: () => ({
    meta: [{ title: "Join a team — OpenJudge" }],
  }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const accept = useServerFn(acceptInvite);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);

  const mutation = useMutation({
    mutationFn: () => accept({ data: { token } }),
    onSuccess: (result) => setState({ ok: true, message: `You joined ${result.teamName}.` }),
    onError: (error) => setState({ ok: false, message: (error as Error).message }),
    retry: false,
  });

  useEffect(() => {
    mutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="mx-auto max-w-md px-5 py-20 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Team invite</h1>
      {mutation.isPending || !state ? (
        <p className="mt-4 font-mono text-sm text-muted-foreground">Accepting your invite…</p>
      ) : state.ok ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <Button onClick={() => navigate({ to: "/submit" })}>Go to your projects</Button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <Button variant="outline" asChild>
            <Link to="/submit">Back to projects</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
