create table if not exists subscribers (
  id bigserial primary key,
  imsi text not null unique,
  msisdn text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
comment on table subscribers is 'One row per provisioned SIM';
comment on column subscribers.imsi is 'International mobile subscriber identity';

create table if not exists plans (
  id serial primary key,
  name text not null,
  price_cents integer not null check (price_cents >= 0)
);

create table if not exists subscriptions (
  id bigserial primary key,
  subscriber_id bigint not null references subscribers(id) on delete cascade,
  plan_id integer not null references plans(id),
  started_at date not null,
  ended_at date,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists subscriptions_subscriber_idx on subscriptions (subscriber_id);

create schema if not exists billing;
create table if not exists billing.invoices (
  id bigserial primary key,
  subscriber_id bigint not null references public.subscribers(id),
  amount_cents integer not null,
  issued_at date not null,
  paid boolean not null default false
);

create or replace view active_subscribers as
  select s.id, s.imsi, s.msisdn, p.name as plan
  from subscribers s
  join subscriptions sub on sub.subscriber_id = s.id and sub.ended_at is null
  join plans p on p.id = sub.plan_id;

insert into plans (name, price_cents) values ('Basic', 1000), ('Plus', 2500), ('Unlimited', 5000)
on conflict do nothing;

insert into subscribers (imsi, msisdn, status)
select '31026' || lpad(g::text, 10, '0'), '+1555' || lpad(g::text, 7, '0'), case when g % 7 = 0 then 'suspended' else 'active' end
from generate_series(1, 60) as g
on conflict do nothing;

insert into subscriptions (subscriber_id, plan_id, started_at, ended_at, metadata)
select s.id, 1 + (s.id % 3)::int, date '2026-01-01' + (s.id % 200)::int, case when s.id % 5 = 0 then date '2026-09-01' else null end,
  jsonb_build_object('source', case when s.id % 2 = 0 then 'portal' else 'api' end)
from subscribers s
where not exists (select 1 from subscriptions x where x.subscriber_id = s.id);

insert into billing.invoices (subscriber_id, amount_cents, issued_at, paid)
select s.id, 1000 + (s.id % 4)::int * 500, date '2026-10-01', s.id % 3 = 0
from subscribers s
where not exists (select 1 from billing.invoices i where i.subscriber_id = s.id);

grant usage on schema public, billing to readonly_user;
grant select on all tables in schema public, billing to readonly_user;
