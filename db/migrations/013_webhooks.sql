-- T4 webhooks: organizer-managed subscriptions plus a delivery log.
-- Deliveries are best-effort with HMAC-signed payloads.

create table if not exists public.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  url text not null,
  secret text not null,
  events text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists webhook_subscriptions_event_id_idx on public.webhook_subscriptions (event_id);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.webhook_subscriptions(id) on delete cascade,
  event text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts int not null default 0,
  last_error text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists webhook_deliveries_subscription_idx on public.webhook_deliveries (subscription_id);
