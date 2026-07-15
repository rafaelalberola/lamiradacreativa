-- ============================================================
-- Metrics backoffice — schema
-- Ejecutar en el SQL editor de Supabase (una sola vez).
-- ============================================================

-- 1) Configuración editable del backoffice (presupuesto de publi + targets)
--    Fila única id = 1. La UI la lee y la escribe vía metrics-api.
create table if not exists metrics_config (
  id                 int primary key default 1,
  monthly_ad_budget  numeric not null default 600,     -- presupuesto mensual para publi (€)
  other_ad_spend     numeric not null default 0,       -- gasto en publi NO-Meta este mes (€)
  product_price      numeric not null default 69,      -- precio actual de referencia (€)
  target_roas        numeric not null default 2,       -- ROAS objetivo
  target_cpl         numeric not null default 3,       -- CPL objetivo (€)
  target_cac         numeric not null default 15,      -- CAC objetivo (€)
  updated_at         timestamptz not null default now(),
  constraint metrics_config_singleton check (id = 1)
);

insert into metrics_config (id) values (1)
on conflict (id) do nothing;

-- 2) Analítica de visitas propia (reemplaza a Amplitude en el funnel)
--    Beacon ligero: /.netlify/functions/track inserta aquí.
create table if not exists events (
  id           bigint generated always as identity primary key,
  event        text not null,                 -- 'pageview' | 'lead' | 'checkout_start' | ...
  path         text,
  device_id    text,                          -- id anónimo en localStorage (sin PII)
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_content  text,
  utm_term     text,
  referrer     text,
  created_at   timestamptz not null default now()
);

create index if not exists events_created_at_idx on events (created_at);
create index if not exists events_event_idx       on events (event);
create index if not exists events_utm_source_idx  on events (utm_source);

-- Las functions usan la service-role key (bypassa RLS). Activamos RLS y
-- NO creamos políticas públicas: solo el servidor escribe/lee.
alter table events         enable row level security;
alter table metrics_config enable row level security;
