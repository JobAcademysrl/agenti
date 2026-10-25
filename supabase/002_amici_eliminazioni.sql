-- Piattaforma MIA · aggiornamento 2: "Porta un amico" (200 € di sconto per amico accettato),
-- eliminazione di clienti e agenti dall'amministrazione, totali delle provvigioni per agente.
-- Da eseguire dopo schema.sql (SQL Editor → Run). Si può rieseguire.

-- ---------- porta un amico ----------
alter table public.clients add column if not exists amici_previsti int check (amici_previsti between 0 and 50);
alter table public.clients add column if not exists presentato_da uuid references public.clients (id) on delete set null;
alter table public.clients add column if not exists presentato_da_testo text;
alter table public.clients add column if not exists codice_amico text unique;
create index if not exists clients_presentato_idx on public.clients (presentato_da);

-- Sconto per amico la cui pratica è accettata (o pagata, conclusa)
create or replace function public.sconto_per_amico() returns numeric language sql immutable set search_path = '' as $$ select 200::numeric $$;

create or replace function public.gen_codice_amico() returns text
language plpgsql volatile set search_path = public as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; code text;
begin
  loop
    code := '';
    for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.clients where codice_amico = code);
  end loop;
  return code;
end $$;
update public.clients set codice_amico = public.gen_codice_amico() where codice_amico is null;
alter table public.clients alter column codice_amico set default public.gen_codice_amico();

-- amici presentati e accettati, e sconto maturato (mai oltre il costo della pratica)
create or replace function public.amici_accettati(p uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.clients f where f.presentato_da = p and f.stato in ('accettato', 'pagato', 'concluso')
$$;

-- la richiesta del cliente ora restituisce anche il suo codice amico
drop function if exists public.submit_client(jsonb);
create function public.submit_client(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare agent uuid; amico uuid; rec record; t text := p ->> 't';
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
  select id into amico from public.clients where codice_amico = upper(trim(coalesce(p ->> 'amico', '')));
  insert into public.clients (agent_id, tipo, nome, cognome, codice_fiscale, ragione_sociale, partita_iva, forma_giuridica,
    amministratore, telefono, email, importo_richiesto, attivita, documenti, consenso_privacy_at, consenso_inoltro, versione_privacy,
    amici_previsti, presentato_da, presentato_da_testo)
  values (agent, t, nullif(trim(p ->> 'nome'), ''), nullif(trim(p ->> 'cognome'), ''), nullif(upper(p ->> 'codice_fiscale'), ''),
    nullif(trim(p ->> 'ragione_sociale'), ''), nullif(p ->> 'partita_iva', ''), nullif(p ->> 'forma_giuridica', ''),
    nullif(trim(p ->> 'amministratore'), ''), trim(p ->> 'telefono'), lower(trim(p ->> 'email')),
    nullif(p ->> 'importo', '')::numeric, nullif(trim(p ->> 'attivita'), ''),
    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p -> 'documenti') = 'array' then p -> 'documenti' else '[]'::jsonb end)), '{}'),
    now(), coalesce((p ->> 'consenso_inoltro')::boolean, false), coalesce(p ->> 'versione_privacy', ''),
    least(greatest(coalesce(nullif(p ->> 'amici_previsti', '')::int, 0), 0), 50), amico,
    case when amico is null then nullif(left(trim(p ->> 'presentato_da'), 120), '') end)
  returning id, codice_amico into rec;
  return jsonb_build_object('id', rec.id, 'codice', rec.codice_amico);
end $$;

-- area agente: amici e sconto sui propri clienti
drop function if exists public.my_clients();
create function public.my_clients()
returns table (id uuid, livello int, agente text, cliente text, telefono text, email text, tipo text,
               importo numeric, costo_pratica numeric, stato public.stato_cliente, creato_il date, provvigione numeric,
               amici_previsti int, amici_accettati int, sconto numeric, presentato_da text)
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
    public.provvigione_livello(t.livello),
    coalesce(c.amici_previsti, 0), public.amici_accettati(c.id),
    least(public.amici_accettati(c.id) * public.sconto_per_amico(), coalesce(c.costo_pratica, 0)),
    case when t.livello = 1 then coalesce((select coalesce(p.ragione_sociale, p.nome || ' ' || p.cognome) from public.clients p where p.id = c.presentato_da), c.presentato_da_testo) end
  from tree t join public.clients c on c.agent_id = t.id join public.agents a on a.id = t.id
  order by c.created_at desc
$$;

-- ---------- amministrazione ----------
drop function if exists public.admin_clients();
create function public.admin_clients()
returns table (id uuid, creato_il timestamptz, tipo text, cliente text, codice text, telefono text, email text,
               importo numeric, costo_pratica numeric, stato public.stato_cliente, agente text, agente_email text,
               documenti text[], consenso_inoltro boolean, note_admin text, attivita text, pagato_at timestamptz,
               codice_amico text, amici_previsti int, amici_accettati int, sconto numeric, presentato_da text, presentato_da_testo text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  return query
  select c.id, c.created_at, c.tipo, coalesce(c.ragione_sociale, c.nome || ' ' || c.cognome),
    coalesce(c.partita_iva, c.codice_fiscale), c.telefono, c.email, c.importo_richiesto, c.costo_pratica, c.stato,
    a.nome || ' ' || a.cognome, a.email, c.documenti, c.consenso_inoltro, c.note_admin, c.attivita, c.pagato_at,
    c.codice_amico, coalesce(c.amici_previsti, 0), public.amici_accettati(c.id),
    least(public.amici_accettati(c.id) * public.sconto_per_amico(), coalesce(c.costo_pratica, 0)),
    (select coalesce(p.ragione_sociale, p.nome || ' ' || p.cognome) || ' (' || p.codice_amico || ')' from public.clients p where p.id = c.presentato_da),
    c.presentato_da_testo
  from public.clients c left join public.agents a on a.id = c.agent_id
  order by c.created_at desc;
end $$;

-- collega a mano un cliente all'amico che l'ha presentato (codice amico), o lo scollega con codice vuoto
create or replace function public.admin_set_presentatore(p_id uuid, p_codice text) returns void
language plpgsql security definer set search_path = public as $$
declare amico uuid;
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  if coalesce(trim(p_codice), '') <> '' then
    select id into amico from public.clients where codice_amico = upper(trim(p_codice));
    if amico is null then raise exception 'Codice amico non trovato'; end if;
    if amico = p_id then raise exception 'Un cliente non può presentare sé stesso'; end if;
  end if;
  update public.clients set presentato_da = amico where id = p_id;
end $$;

-- elimina un cliente (e le sue provvigioni); restituisce i documenti da cancellare dallo Storage
create or replace function public.admin_delete_client(p_id uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare docs text[];
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  delete from public.clients where id = p_id returning documenti into docs;
  if not found then raise exception 'Cliente non trovato'; end if;
  return coalesce(docs, '{}');
end $$;

-- elimina un agente: la sua rete passa al suo sponsor, i suoi clienti restano senza agente
create or replace function public.admin_delete_agent(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare up uuid;
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  if p_id = auth.uid() then raise exception 'Non puoi eliminare il tuo profilo'; end if;
  select sponsor_id into up from public.agents where id = p_id;
  if not found then raise exception 'Agente non trovato'; end if;
  update public.agents set sponsor_id = up where sponsor_id = p_id;
  delete from auth.users where id = p_id;  -- cancella anche la scheda agente (on delete cascade)
end $$;

drop function if exists public.admin_agents();
create function public.admin_agents()
returns table (id uuid, nome text, cognome text, email text, telefono text, data_nascita date, iscritto_oam boolean,
               qualifica public.qualifica, attivo boolean, sponsor text, ref_code text, iscritto_il timestamptz,
               diretti int, clienti int, prov_da_liquidare numeric, prov_liquidate numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  return query
  select a.id, a.nome, a.cognome, a.email, a.telefono, a.data_nascita, a.iscritto_oam, a.qualifica, a.attivo,
    s.nome || ' ' || s.cognome, a.ref_code, a.created_at,
    (select count(*)::int from public.agents x where x.sponsor_id = a.id),
    (select count(*)::int from public.clients c where c.agent_id = a.id),
    (select coalesce(sum(m.importo), 0) from public.commissions m where m.agent_id = a.id and m.stato = 'da_liquidare'),
    (select coalesce(sum(m.importo), 0) from public.commissions m where m.agent_id = a.id and m.stato = 'liquidata')
  from public.agents a left join public.agents s on s.id = a.sponsor_id
  order by a.created_at desc;
end $$;

-- ---------- permessi ----------
revoke all on function public.submit_client(jsonb), public.my_clients(), public.admin_clients(), public.admin_agents(),
  public.admin_set_presentatore(uuid, text), public.admin_delete_client(uuid), public.admin_delete_agent(uuid),
  public.amici_accettati(uuid), public.gen_codice_amico() from public, anon, authenticated;
grant execute on function public.submit_client(jsonb) to anon, authenticated;
grant execute on function public.my_clients(), public.admin_clients(), public.admin_agents(), public.admin_set_presentatore(uuid, text),
  public.admin_delete_client(uuid), public.admin_delete_agent(uuid) to authenticated;

drop policy if exists "admin elimina i documenti" on storage.objects;
create policy "admin elimina i documenti" on storage.objects for delete to authenticated
  using (bucket_id = 'documenti-clienti' and public.is_admin());
