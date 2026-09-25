import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createEvent,
  createPrize,
  createQuestion,
  deletePrize,
  deleteQuestion,
  listEvents,
  listPrizes,
  listQuestions,
} from "@/lib/organizer.functions";

/** Event switcher + creation (name, slug, dates, tracks, review load). */
export function EventsCard({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const fetchEvents = useServerFn(listEvents);
  const create = useServerFn(createEvent);
  const events = useQuery({ queryKey: ["events"], queryFn: () => fetchEvents() });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [tracks, setTracks] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          name,
          slug,
          tagline: "",
          description: "",
          // datetime-local has no offset; the form labels it UTC explicitly.
          startsAt: startsAt ? `${startsAt}:00Z` : null,
          endsAt: endsAt ? `${endsAt}:00Z` : null,
          reviewsPerSubmission: 3,
          tracks: tracks
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: (result) => {
      setName("");
      setSlug("");
      setStartsAt("");
      setEndsAt("");
      setTracks("");
      queryClient.invalidateQueries({ queryKey: ["events"] });
      onSelect(result.id);
      toast.success("Event created.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Events</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(events.data ?? []).map((event) => (
            <Button
              key={event.id}
              size="sm"
              variant={event.id === selectedId ? "default" : "outline"}
              onClick={() => onSelect(event.id)}
            >
              {event.name}
            </Button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="event-name">Name</Label>
            <Input id="event-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-slug">Slug</Label>
            <Input
              id="event-slug"
              placeholder="openhack-2027"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-starts">Starts (UTC)</Label>
            <Input
              id="event-starts"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-ends">Ends (UTC)</Label>
            <Input
              id="event-ends"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="event-tracks">Tracks (comma separated)</Label>
            <Input
              id="event-tracks"
              placeholder="Developer Tools, Climate & Cities"
              value={tracks}
              onChange={(e) => setTracks(e.target.value)}
            />
          </div>
        </div>
        <Button disabled={!name.trim() || !slug.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
          Create event
        </Button>
      </CardContent>
    </Card>
  );
}

/** Prize ladder for the event (position, title, amount). Shown on the home page. */
export function PrizesCard({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const fetchPrizes = useServerFn(listPrizes);
  const create = useServerFn(createPrize);
  const remove = useServerFn(deletePrize);
  const prizes = useQuery({ queryKey: ["prizes", eventId], queryFn: () => fetchPrizes({ data: { eventId } }) });
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["prizes", eventId] });
  const createMutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          eventId,
          position: (prizes.data ?? []).length + 1,
          title,
          amount,
        },
      }),
    onSuccess: () => {
      setTitle("");
      setAmount("");
      invalidate();
      toast.success("Prize added.");
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Prize removed.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prizes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1 text-sm">
          {(prizes.data ?? []).map((prize) => (
            <li key={prize.id} className="flex items-center justify-between gap-2">
              <span>
                {prize.position}. {prize.title}
                {prize.amount && <span className="ml-2 font-mono text-xs text-muted-foreground">{prize.amount}</span>}
              </span>
              <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(prize.id)}>
                Remove
              </Button>
            </li>
          ))}
          {(prizes.data ?? []).length === 0 && (
            <li className="text-xs text-muted-foreground">No prizes yet.</li>
          )}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-2">
            <Label htmlFor="prize-title">Title</Label>
            <Input id="prize-title" placeholder="Grand Prize" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="w-32 space-y-2">
            <Label htmlFor="prize-amount">Amount</Label>
            <Input id="prize-amount" placeholder="$800" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <Button size="sm" disabled={!title.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
            Add prize
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Organizer-defined custom submission questions for the event. */
export function QuestionsCard({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const fetchQuestions = useServerFn(listQuestions);
  const create = useServerFn(createQuestion);
  const remove = useServerFn(deleteQuestion);
  const questions = useQuery({
    queryKey: ["questions", eventId],
    queryFn: () => fetchQuestions({ data: { eventId } }),
  });
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("text");
  const [required, setRequired] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["questions", eventId] });
  const createMutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          eventId,
          label,
          kind: kind as "text" | "url" | "number" | "boolean",
          required,
        },
      }),
    onSuccess: () => {
      setLabel("");
      setRequired(false);
      invalidate();
      toast.success("Question added.");
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Question removed.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom questions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1 text-sm">
          {(questions.data ?? []).map((question) => (
            <li key={question.id} className="flex items-center justify-between gap-2">
              <span>
                {question.label}
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {question.kind}
                  {question.required ? " · required" : ""}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(question.id)}>
                Remove
              </Button>
            </li>
          ))}
          {(questions.data ?? []).length === 0 && (
            <li className="text-xs text-muted-foreground">No custom questions yet.</li>
          )}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-2">
            <Label htmlFor="question-label">Label</Label>
            <Input
              id="question-label"
              placeholder="What should judges try first?"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="question-kind">Kind</Label>
            <select
              id="question-kind"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {["text", "url", "number", "boolean"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            Required
          </label>
          <Button size="sm" disabled={!label.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
            Add question
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
