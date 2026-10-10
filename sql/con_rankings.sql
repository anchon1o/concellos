-- =====================================================================
-- Concellos de Galicia: rankings no proxecto Supabase "xogos" (prefixo con_)
-- Executar unha vez en Supabase > SQL Editor. Pódese repetir sen romper nada.
-- =====================================================================

-- ---------- Reto (os 313 ou unha provincia, por nivel) ----------
create table if not exists public.con_ranking_reto (
  id        uuid        primary key default gen_random_uuid(),
  alias     text        not null check (char_length(alias) between 1 and 20),
  nivel     text        not null check (nivel in ('facil','medio','dificil','perfecto')),
  zona      text        not null check (zona in ('todo','15','27','32','36')),
  acertos   smallint    not null check (acertos >= 1),
  total     smallint    not null check (total in (313, 93, 67, 92, 61)),
  erros     integer     not null default 0 check (erros between 0 and 100000),
  tempo_ms  integer     not null check (tempo_ms between 1000 and 36000000),
  creado    timestamptz not null default now(),
  check (acertos <= total)
);
create index if not exists con_ranking_reto_orde
  on public.con_ranking_reto (nivel, zona, acertos desc, erros asc, tempo_ms asc);

-- ---------- Reto diario (10 concellos, mesmos para todos cada día) ----------
create table if not exists public.con_ranking_diario (
  id        uuid        primary key default gen_random_uuid(),
  data      date        not null default ((now() at time zone 'Europe/Madrid')::date),
  alias     text        not null check (char_length(alias) between 1 and 20),
  puntos    smallint    not null check (puntos between 1 and 30),
  acertos   smallint    not null check (acertos between 1 and 10),
  erros     integer     not null default 0 check (erros between 0 and 1000),
  tempo_ms  integer     not null check (tempo_ms between 400 and 7200000),
  creado    timestamptz not null default now(),
  check (puntos between acertos and acertos * 3)
);
create index if not exists con_ranking_diario_orde
  on public.con_ranking_diario (data, puntos desc, erros asc, tempo_ms asc);

-- ---------- Seguridade ----------
-- Lectura pública (para o xogo e para cagando). Ningunha política de escritura:
-- só escribe a función de Vercel coa clave secreta, que valida as marcas.
alter table public.con_ranking_reto   enable row level security;
alter table public.con_ranking_diario enable row level security;

drop policy if exists con_ranking_reto_ler   on public.con_ranking_reto;
drop policy if exists con_ranking_diario_ler on public.con_ranking_diario;
create policy con_ranking_reto_ler   on public.con_ranking_reto   for select to anon, authenticated using (true);
create policy con_ranking_diario_ler on public.con_ranking_diario for select to anon, authenticated using (true);

grant select on public.con_ranking_reto, public.con_ranking_diario to anon, authenticated;
