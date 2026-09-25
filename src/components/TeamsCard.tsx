import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTeam, inviteToTeam, myTeams, revokeInvite, teamInvites } from "@/lib/mesh/team.functions";

/**
 * Team roster with revocable invite links. Backed by the self-host Postgres
 * team store; degrades to an explanatory note where that database is absent
 * (hosted previews) instead of breaking the submit page.
 */
export function TeamsCard({ eventId }: { eventId: string | null }) {
  const queryClient = useQueryClient();
  const fetchTeams = useServerFn(myTeams);
  const create = useServerFn(createTeam);
  const invite = useServerFn(inviteToTeam);
  const listInvites = useServerFn(teamInvites);
  const revoke = useServerFn(revokeInvite);
  const [name, setName] = useState("");
  const [openTeam, setOpenTeam] = useState<string | null>(null);

  const teams = useQuery({
    queryKey: ["my-teams"],
    queryFn: () => fetchTeams(),
    retry: false,
  });
  const invites = useQuery({
    queryKey: ["team-invites", openTeam],
    queryFn: () => listInvites({ data: { teamId: openTeam! } }),
    enabled: openTeam !== null,
    retry: false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["my-teams"] });
    queryClient.invalidateQueries({ queryKey: ["team-invites"] });
  };

  const createMutation = useMutation({
    mutationFn: () => create({ data: { eventId: eventId!, name } }),
    onSuccess: () => {
      setName("");
      invalidate();
      toast.success("Team created.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const inviteMutation = useMutation({
    mutationFn: (teamId: string) => invite({ data: { teamId, maxUses: 0 } }),
    onSuccess: () => {
      invalidate();
      toast.success("Invite link created.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => revoke({ data: { inviteId } }),
    onSuccess: () => {
      invalidate();
      toast.success("Invite revoked.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  if (teams.error) {
    return (
      <Card className="mt-10">
        <CardHeader>
          <CardTitle>Teams</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Team invites need the self-host database (`docker compose up db`). {(teams.error as Error).message}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-10">
      <CardHeader>
        <CardTitle>Teams</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(teams.data ?? []).map((team) => (
          <div key={team.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{team.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {team.members} member{team.members === "1" ? "" : "s"} · you are {team.my_role}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setOpenTeam(openTeam === team.id ? null : team.id);
                  }}
                >
                  {openTeam === team.id ? "Hide invites" : "Invite links"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={inviteMutation.isPending}
                  onClick={() => inviteMutation.mutate(team.id)}
                >
                  New invite
                </Button>
              </div>
            </div>
            {openTeam === team.id && (
              <div className="mt-3 space-y-2">
                {invites.isLoading && <p className="text-xs text-muted-foreground">Loading invites…</p>}
                {(invites.data ?? []).map((inv) => {
                  const link = `${window.location.origin}/team/${inv.token}`;
                  return (
                    <div key={inv.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <Input className="min-w-52 flex-1 font-mono" readOnly value={link} aria-label={`Invite link for ${team.name}`} />
                      <a className="underline underline-offset-4" href={link}>
                        Open
                      </a>
                      {inv.revoked ? (
                        <span className="text-muted-foreground">revoked</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={revokeMutation.isPending}
                          onClick={() => revokeMutation.mutate(inv.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  );
                })}
                {(invites.data ?? []).length === 0 && !invites.isLoading && (
                  <p className="text-xs text-muted-foreground">No invite links yet — create one.</p>
                )}
              </div>
            )}
          </div>
        ))}

        {eventId && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-52 flex-1 space-y-2">
              <Label htmlFor="new-team-name">New team</Label>
              <Input
                id="new-team-name"
                placeholder="Team name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <Button disabled={!name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
              Create team
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
