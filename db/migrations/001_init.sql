create extension if not exists pgcrypto;

create table if not exists installations (
  installation_id bigint primary key,
  account_login text not null,
  created_at timestamptz not null default now()
);

create table if not exists repositories (
  installation_id bigint not null references installations(installation_id),
  owner text not null,
  name text not null,
  default_branch text not null default 'main',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (installation_id, owner, name)
);

create table if not exists webhook_deliveries (
  delivery_id text primary key,
  event_name text not null,
  received_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  installation_id bigint,
  owner text not null,
  name text not null,
  commit_sha text,
  kind text not null,
  state text not null,
  payload jsonb not null default '{}',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_ready_idx on jobs (available_at, created_at) where state = 'received';

create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  category text not null,
  title text not null,
  rationale text not null,
  evidence jsonb not null default '[]',
  confidence numeric not null,
  severity text not null,
  affected_files jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists validation_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  command text not null,
  exit_code integer,
  output text not null default '',
  passed boolean not null,
  created_at timestamptz not null default now()
);

create table if not exists pull_requests (
  job_id uuid primary key references jobs(id),
  owner text not null,
  name text not null,
  number integer not null,
  url text not null,
  merge_status text not null,
  merge_reasons jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid,
  event_type text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
