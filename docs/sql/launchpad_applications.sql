-- Launchpad tokenization applications (proposals).
-- Run once in the Supabase SQL editor (Dashboard > SQL > New query).
-- Idempotent: safe to re-run.

create table if not exists public.launchpad_applications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.launchpad_accounts(id) on delete cascade,
  status text not null default 'submitted'
    check (status in ('submitted', 'in_review', 'changes_requested', 'approved', 'rejected')),
  issuer_name text not null,
  issuer_country text not null,
  asset_name text not null,
  asset_type text not null
    check (asset_type in ('real_estate', 'private_credit', 'invoices', 'agriculture', 'energy', 'other')),
  description text not null,
  target_amount numeric(18, 2) not null check (target_amount > 0),
  currency text not null default 'USD',
  min_ticket numeric(18, 2) not null check (min_ticket > 0),
  expected_yield_pct numeric(6, 3),
  term_months integer check (term_months > 0),
  max_investors integer check (max_investors > 0),
  offering_type text not null default 'private'
    check (offering_type in ('private', 'public')),
  investor_countries text[] not null default '{}',
  accepts_us_investors boolean not null default false,
  uses_mass_marketing boolean not null default false,
  milestones jsonb not null default '[]'::jsonb,
  documents jsonb not null default '[]'::jsonb,
  ai_summary text,
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists launchpad_applications_status_created_at_idx
  on public.launchpad_applications (status, created_at desc);

create index if not exists launchpad_applications_account_id_idx
  on public.launchpad_applications (account_id);

create or replace function public.launchpad_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists launchpad_applications_set_updated_at
  on public.launchpad_applications;

create trigger launchpad_applications_set_updated_at
  before update on public.launchpad_applications
  for each row
  execute function public.launchpad_set_updated_at();

alter table public.launchpad_applications enable row level security;
