-- Piattaforma MIA (Microcredito Info Agents) · Job Academy srl
-- Da eseguire una volta in Supabase: SQL Editor → New query → incolla tutto → Run.
-- Tutte le letture e scritture passano da funzioni con controlli espliciti; le tabelle sono chiuse dalla RLS.

-- ---------- tipi ----------
do $$ begin
  create type public.qualifica as enum ('Junior', 'Senior', 'Manager', 'Director');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.stato_cliente as enum ('in_valutazione', 'accettato', 'respinto', 'pagato', 'concluso');
exception when duplicate_object then null; end $$;

-- ---------- tabelle ----------
create table if not exists public.agents (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  cognome text not null,
  data_nascita date not null,
  telefono text not null,
  email text not null unique,
  iscritto_oam boolean not null,
  consenso_privacy_at timestamptz not null,
  versione_privacy text not null,
  sponsor_id uuid references public.agents (id) on delete set null,
  ref_code text not null unique,
  qualifica public.qualifica not null default 'Junior',
  is_admin boolean not null default false,
  attivo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists agents_sponsor_idx on public.agents (sponsor_id);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agents (id) on delete set null,
  tipo text not null check (tipo in ('persona_fisica', 'azienda')),
  nome text, cognome text, codice_fiscale text,
  ragione_sociale text, partita_iva text, forma_giuridica text, amministratore text,
  telefono text not null,
  email text not null,
  importo_richiesto numeric(12, 2) check (importo_richiesto is null or importo_richiesto between 1000 and 100000),
  costo_pratica numeric(12, 2) generated always as (
    case when importo_richiesto is null then null
         when importo_richiesto <= 20000 then 2000
         when importo_richiesto <= 35000 then 3500
         else 5000 end) stored,
  attivita text,
  documenti text[] not null default '{}',
  consenso_privacy_at timestamptz not null,
  consenso_inoltro boolean not null default false,
  versione_privacy text not null,
  stato public.stato_cliente not null default 'in_valutazione',
  note_admin text,
  stato_aggiornato_at timestamptz not null default now(),
  pagato_at timestamptz,
  concluso_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists clients_agent_idx on public.clients (agent_id);

create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  agent_id uuid references public.agents (id) on delete set null,
  livello int not null check (livello between 1 and 4),
  importo numeric(12, 2) not null,
  stato text not null default 'da_liquidare' check (stato in ('da_liquidare', 'liquidata')),
  scadenza date not null,
  liquidata_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, livello)
);
create index if not exists commissions_agent_idx on public.commissions (agent_id);

alter table public.agents enable row level security;
alter table public.clients enable row level security;
alter table public.commissions enable row level security;

drop policy if exists "agente legge il proprio profilo" on public.agents;
create policy "agente legge il proprio profilo" on public.agents for select to authenticated using (id = auth.uid());
drop policy if exists "agente legge le proprie provvigioni" on public.commissions;
create policy "agente legge le proprie provvigioni" on public.commissions for select to authenticated using (agent_id = auth.uid());
-- clients: nessuna policy, si accede solo dalle funzioni qui sotto

-- ---------- regole economiche ----------
-- Provvigione per livello di profondità (1 = chi ha portato il cliente)
create or replace function public.provvigione_livello(l int) returns numeric
language sql immutable set search_path = '' as $$ select (array[500, 250, 150, 100])[l]::numeric $$;

-- Aggiunge n giorni lavorativi (lun-ven; le festività non sono considerate)
create or replace function public.add_working_days(d date, n int) returns date
language plpgsql immutable set search_path = '' as $$
declare r date := d; c int := 0;
begin
  while c < n loop
    r := r + 1;
    if extract(isodow from r) < 6 then c := c + 1; end if;
  end loop;
  return r;
end $$;

-- ---------- utilità ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.agents where id = auth.uid()), false)
$$;

create or replace function public.gen_ref_code() returns text
language plpgsql volatile set search_path = public as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; code text;
begin
  loop
    code := '';
    for i in 1..7 loop code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.agents where ref_code = code);
  end loop;
  return code;
end $$;

-- ---------- iscrizione agente ----------
-- Supabase crea l'utente (signInWithOtp con i dati del modulo in options.data); questo trigger crea la scheda agente.
create or replace function public.handle_new_agent() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := new.raw_user_meta_data; sponsor uuid; nascita date;
begin
  if coalesce(m ->> 'tipo', '') <> 'agente' then return new; end if;
  if coalesce(trim(m ->> 'nome'), '') = '' or coalesce(trim(m ->> 'cognome'), '') = ''
     or coalesce(m ->> 'data_nascita', '') = '' or coalesce(trim(m ->> 'telefono'), '') = ''
     or (m ->> 'iscritto_oam') not in ('true', 'false') or (m ->> 'consenso_privacy') <> 'true' then
    raise exception 'Iscrizione incompleta: tutti i campi sono obbligatori';
  end if;
  nascita := (m ->> 'data_nascita')::date;
  if nascita > current_date - interval '18 years' then raise exception 'Per iscriverti devi essere maggiorenne'; end if;
  if (m ->> 'telefono') !~ '^\+?[0-9 ]{6,20}$' then raise exception 'Numero di telefono non valido'; end if;
  select id into sponsor from public.agents where ref_code = upper(trim(coalesce(m ->> 'ref', ''))) and attivo;
  insert into public.agents (id, nome, cognome, data_nascita, telefono, email, iscritto_oam,
    consenso_privacy_at, versione_privacy, sponsor_id, ref_code)
  values (new.id, trim(m ->> 'nome'), trim(m ->> 'cognome'), nascita, trim(m ->> 'telefono'), lower(new.email),
    (m ->> 'iscritto_oam')::boolean, now(), coalesce(m ->> 'versione_privacy', ''), sponsor, public.gen_ref_code());
  return new;
end $$;

drop trigger if exists on_auth_user_created_agent on auth.users;
create trigger on_auth_user_created_agent after insert on auth.users
  for each row execute function public.handle_new_agent();

-- Nome di chi invita (mostrato sul modulo di iscrizione e sul modulo cliente)
create or replace function public.ref_info(code text) returns table (nome text)
language sql stable security definer set search_path = public as $$
  select a.nome || ' ' || left(a.cognome, 1) || '.' from public.agents a
  where a.ref_code = upper(trim(code)) and a.attivo
$$;

-- ---------- richiesta del cliente (modulo pubblico) ----------
create or replace function public.submit_client(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare agent uuid; new_id uuid; t text := p ->> 't';
begin
  if t not in ('persona_fisica', 'azienda') then raise exception 'Tipo di richiedente non valido'; end if;
  if (p ->> 'consenso_privacy') is distinct from 'true' then raise exception 'Serve il consenso al trattamento dei dati'; end if;
  if coalesce(trim(p ->> 'telefono'), '') = '' or coalesce(p ->> 'email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Telefono ed email sono obbligatori';
  end if;
  if t = 'persona_fisica' and (coalesce(trim(p ->> 'nome'), '') = '' or coalesce(trim(p ->> 'cognome'), '') = ''
     or upper(coalesce(p ->> 'codice_fiscale', '')) !~ '^[A-Z0-9]{16}$') then
    raise exception 'Nome, cognome e codice fiscale sono obbligatori';
  end if;
  if t = 'azienda' and (coalesce(trim(p ->> 'ragione_sociale'), '') = '' or coalesce(p ->> 'partita_iva', '') !~ '^[0-9]{11}$'
     or coalesce(trim(p ->> 'forma_giuridica'), '') = '' or coalesce(trim(p ->> 'amministratore'), '') = '') then
    raise exception 'Ragione sociale, partita IVA, forma giuridica e amministratore sono obbligatori';
  end if;
  select id into agent from public.agents where ref_code = upper(trim(coalesce(p ->> 'ref', ''))) and attivo;
  insert into public.clients (agent_id, tipo, nome, cognome, codice_fiscale, ragione_sociale, partita_iva, forma_giuridica,
    amministratore, telefono, email, importo_richiesto, attivita, documenti, consenso_privacy_at, consenso_inoltro, versione_privacy)
  values (agent, t, nullif(trim(p ->> 'nome'), ''), nullif(trim(p ->> 'cognome'), ''), nullif(upper(p ->> 'codice_fiscale'), ''),
    nullif(trim(p ->> 'ragione_sociale'), ''), nullif(p ->> 'partita_iva', ''), nullif(p ->> 'forma_giuridica', ''),
    nullif(trim(p ->> 'amministratore'), ''), trim(p ->> 'telefono'), lower(trim(p ->> 'email')),
    nullif(p ->> 'importo', '')::numeric, nullif(trim(p ->> 'attivita'), ''),
    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p -> 'documenti') = 'array' then p -> 'documenti' else '[]'::jsonb end)), '{}'),
    now(), coalesce((p ->> 'consenso_inoltro')::boolean, false), coalesce(p ->> 'versione_privacy', ''))
  returning id into new_id;
  return new_id;
end $$;

-- ---------- area agente ----------
-- Rete fino al 4° livello sotto l'agente collegato
create or replace function public.my_network()
returns table (id uuid, sponsor_id uuid, livello int, nome text, qualifica public.qualifica, iscritto_il date,
               telefono text, email text, clienti int, clienti_pagati int)
language sql stable security definer set search_path = public as $$
  with recursive tree as (
    select a.id, a.sponsor_id, 1 as livello from public.agents a where a.sponsor_id = auth.uid()
    union all
    select a.id, a.sponsor_id, t.livello + 1 from public.agents a join tree t on a.sponsor_id = t.id where t.livello < 4
  )
  select t.id, t.sponsor_id, t.livello,
    a.nome || ' ' || left(a.cognome, 1) || '.', a.qualifica, a.created_at::date,
    -- recapiti solo per gli iscritti diretti
    case when t.livello = 1 then a.telefono end, case when t.livello = 1 then a.email end,
    (select count(*)::int from public.clients c where c.agent_id = t.id),
    (select count(*)::int from public.clients c where c.agent_id = t.id and c.stato in ('pagato', 'concluso'))
  from tree t join public.agents a on a.id = t.id
  order by t.livello, a.created_at
$$;

-- Clienti dell'agente (livello 1, con recapiti) e della sua rete (livelli 2-4, solo iniziali)
create or replace function public.my_clients()
returns table (id uuid, livello int, agente text, cliente text, telefono text, email text, tipo text,
               importo numeric, costo_pratica numeric, stato public.stato_cliente, creato_il date, provvigione numeric)
language sql stable security definer set search_path = public as $$
  with recursive tree as (
    select auth.uid() as id, 1 as livello
    union all
    select a.id, t.livello + 1 from public.agents a join tree t on a.sponsor_id = t.id where t.livello < 4
  )
  select c.id, t.livello, a.nome || ' ' || left(a.cognome, 1) || '.',
    case when t.livello = 1 then coalesce(c.ragione_sociale, c.nome || ' ' || c.cognome)
         else coalesce(left(c.ragione_sociale, 1) || '***', left(c.nome, 1) || '. ' || left(c.cognome, 1) || '.') end,
    case when t.livello = 1 then c.telefono end, case when t.livello = 1 then c.email end,
    c.tipo, c.importo_richiesto, c.costo_pratica, c.stato, c.created_at::date,
    public.provvigione_livello(t.livello)
  from tree t join public.clients c on c.agent_id = t.id join public.agents a on a.id = t.id
  order by c.created_at desc
$$;

create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'nome', a.nome, 'cognome', a.cognome, 'email', a.email, 'telefono', a.telefono,
    'qualifica', a.qualifica, 'ref_code', a.ref_code, 'is_admin', a.is_admin, 'iscritto_oam', a.iscritto_oam,
    'iscritto_il', a.created_at::date,
    'sponsor', (select s.nome || ' ' || left(s.cognome, 1) || '.' from public.agents s where s.id = a.sponsor_id),
    'maturate', (select coalesce(sum(importo), 0) from public.commissions where agent_id = a.id),
    'liquidate', (select coalesce(sum(importo), 0) from public.commissions where agent_id = a.id and stato = 'liquidata'),
    'da_liquidare', (select coalesce(sum(importo), 0) from public.commissions where agent_id = a.id and stato = 'da_liquidare'))
  from public.agents a where a.id = auth.uid()
$$;

-- ---------- amministrazione ----------
create or replace function public.admin_clients()
returns table (id uuid, creato_il timestamptz, tipo text, cliente text, codice text, telefono text, email text,
               importo numeric, costo_pratica numeric, stato public.stato_cliente, agente text, agente_email text,
               documenti text[], consenso_inoltro boolean, note_admin text, attivita text, pagato_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  return query
  select c.id, c.created_at, c.tipo, coalesce(c.ragione_sociale, c.nome || ' ' || c.cognome),
    coalesce(c.partita_iva, c.codice_fiscale), c.telefono, c.email, c.importo_richiesto, c.costo_pratica, c.stato,
    a.nome || ' ' || a.cognome, a.email, c.documenti, c.consenso_inoltro, c.note_admin, c.attivita, c.pagato_at
  from public.clients c left join public.agents a on a.id = c.agent_id
  order by c.created_at desc;
end $$;

create or replace function public.admin_set_status(p_id uuid, p_stato public.stato_cliente, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur public.stato_cliente; ag uuid; lvl int := 1; due date;
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  select stato, agent_id into cur, ag from public.clients where id = p_id for update;
  if not found then raise exception 'Cliente non trovato'; end if;
  if not ((cur = 'in_valutazione' and p_stato in ('accettato', 'respinto'))
       or (cur = 'accettato' and p_stato in ('pagato', 'respinto'))
       or (cur = 'pagato' and p_stato = 'concluso')
       or cur = p_stato) then
    raise exception 'Passaggio di stato non ammesso: % → %', cur, p_stato;
  end if;
  update public.clients set stato = p_stato, note_admin = coalesce(p_note, note_admin), stato_aggiornato_at = now(),
    pagato_at = case when p_stato = 'pagato' and pagato_at is null then now() else pagato_at end,
    concluso_at = case when p_stato = 'concluso' then now() else concluso_at end
  where id = p_id;
  -- al pagamento: provvigioni per i 4 livelli sopra l'agente che ha portato il cliente
  if p_stato = 'pagato' and cur <> 'pagato' then
    due := public.add_working_days(current_date, 10);
    while ag is not null and lvl <= 4 loop
      insert into public.commissions (client_id, agent_id, livello, importo, scadenza)
      values (p_id, ag, lvl, public.provvigione_livello(lvl), due) on conflict do nothing;
      select sponsor_id into ag from public.agents where id = ag;
      lvl := lvl + 1;
    end loop;
  end if;
end $$;

create or replace function public.admin_set_importo(p_id uuid, p_importo numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  update public.clients set importo_richiesto = p_importo where id = p_id and stato in ('in_valutazione', 'accettato');
  if not found then raise exception 'Importo modificabile solo prima del pagamento'; end if;
end $$;

create or replace function public.admin_agents()
returns table (id uuid, nome text, cognome text, email text, telefono text, data_nascita date, iscritto_oam boolean,
               qualifica public.qualifica, attivo boolean, sponsor text, ref_code text, iscritto_il timestamptz,
               diretti int, clienti int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  return query
  select a.id, a.nome, a.cognome, a.email, a.telefono, a.data_nascita, a.iscritto_oam, a.qualifica, a.attivo,
    s.nome || ' ' || s.cognome, a.ref_code, a.created_at,
    (select count(*)::int from public.agents x where x.sponsor_id = a.id),
    (select count(*)::int from public.clients c where c.agent_id = a.id)
  from public.agents a left join public.agents s on s.id = a.sponsor_id
  order by a.created_at desc;
end $$;

create or replace function public.admin_set_agent(p_id uuid, p_qualifica public.qualifica, p_attivo boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  update public.agents set qualifica = p_qualifica, attivo = p_attivo where id = p_id;
end $$;

create or replace function public.admin_commissions()
returns table (id uuid, agente text, agente_email text, cliente text, livello int, importo numeric, stato text,
               scadenza date, liquidata_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  return query
  select m.id, a.nome || ' ' || a.cognome, a.email, coalesce(c.ragione_sociale, c.nome || ' ' || c.cognome),
    m.livello, m.importo, m.stato, m.scadenza, m.liquidata_at
  from public.commissions m join public.clients c on c.id = m.client_id left join public.agents a on a.id = m.agent_id
  order by m.stato, m.scadenza;
end $$;

create or replace function public.admin_pay_commission(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  update public.commissions set stato = 'liquidata', liquidata_at = now() where id = p_id and stato = 'da_liquidare';
end $$;

-- ---------- permessi sulle funzioni ----------
revoke all on function public.ref_info(text), public.submit_client(jsonb), public.my_network(), public.my_clients(),
  public.my_profile(), public.admin_clients(), public.admin_set_status(uuid, public.stato_cliente, text),
  public.admin_set_importo(uuid, numeric), public.admin_agents(), public.admin_set_agent(uuid, public.qualifica, boolean),
  public.admin_commissions(), public.admin_pay_commission(uuid), public.is_admin(), public.gen_ref_code(),
  public.handle_new_agent() from public, anon, authenticated;  -- Supabase concede di default l'esecuzione ad anon e authenticated
grant execute on function public.ref_info(text), public.submit_client(jsonb) to anon, authenticated;
grant execute on function public.my_network(), public.my_clients(), public.my_profile(), public.is_admin(),
  public.admin_clients(), public.admin_set_status(uuid, public.stato_cliente, text), public.admin_set_importo(uuid, numeric),
  public.admin_agents(), public.admin_set_agent(uuid, public.qualifica, boolean), public.admin_commissions(),
  public.admin_pay_commission(uuid) to authenticated;

-- ---------- documenti dei clienti (Storage) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documenti-clienti', 'documenti-clienti', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "caricamento documenti dal modulo" on storage.objects;
create policy "caricamento documenti dal modulo" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'documenti-clienti');
drop policy if exists "admin legge i documenti" on storage.objects;
create policy "admin legge i documenti" on storage.objects for select to authenticated
  using (bucket_id = 'documenti-clienti' and public.is_admin());

-- ---------- dopo la prima iscrizione ----------
-- Per diventare amministratore: iscriviti dal sito con la tua email, poi esegui
--   update public.agents set is_admin = true, qualifica = 'Director' where email = 'info@jobacademyilma.com';
