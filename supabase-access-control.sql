create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  role text not null default 'Cliente' check (role in (
    'Admin',
    'Broker',
    'Coordenadora de Agência',
    'Consultor Imobiliário',
    'Consultor em Formação',
    'Diretor de Agência',
    'Recrutador',
    'Gestor de Marketing',
    'Cliente'
  )),
  company_function text not null default '',
  status text not null default 'active' check (status in ('active', 'blocked', 'deleted')),
  blocked_until timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.access_invites (
  email text primary key,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  role text not null check (role in (
    'Admin',
    'Broker',
    'Coordenadora de Agência',
    'Consultor Imobiliário',
    'Consultor em Formação',
    'Diretor de Agência',
    'Recrutador',
    'Gestor de Marketing',
    'Cliente'
  )),
  company_function text not null default '',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.current_user_profile()
returns public.user_profiles
language sql
stable
security definer
set search_path = public
as $$
  select p
  from public.user_profiles p
  where p.id = auth.uid()
  limit 1
$$;

create or replace function public.is_active_imoflow_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.blocked_until is null or p.blocked_until <= now())
  )
$$;

create or replace function public.can_manage_imoflow_users()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.blocked_until is null or p.blocked_until <= now())
      and p.role in ('Admin', 'Broker')
  )
$$;

create or replace function public.can_view_imoflow_users()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.blocked_until is null or p.blocked_until <= now())
      and p.role in ('Admin', 'Broker', 'Coordenadora de Agência')
  )
$$;

create or replace function public.can_read_internal_crm()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.blocked_until is null or p.blocked_until <= now())
      and p.role <> 'Cliente'
  )
$$;

create or replace function public.can_write_internal_crm()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.blocked_until is null or p.blocked_until <= now())
      and p.role in (
        'Admin',
        'Broker',
        'Coordenadora de Agência',
        'Consultor Imobiliário',
        'Consultor em Formação',
        'Diretor de Agência'
      )
  )
$$;

create or replace function public.provision_imoflow_user(
  user_email text,
  initial_password text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  normalized_email text := lower(trim(user_email));
  new_user_id uuid := gen_random_uuid();
  invite public.access_invites;
begin
  if not public.can_manage_imoflow_users() then
    raise exception 'Sem permissão para criar utilizadores';
  end if;
  if length(initial_password) < 8 then
    raise exception 'A palavra-passe deve ter pelo menos 8 caracteres';
  end if;
  select * into invite
  from public.access_invites
  where lower(email) = normalized_email
  limit 1;
  if invite.email is null then
    raise exception 'O convite do utilizador não foi encontrado';
  end if;
  if exists (select 1 from auth.users where lower(email) = normalized_email) then
    raise exception 'Já existe uma conta com este e-mail';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated',
    normalized_email, crypt(initial_password, gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('first_name', invite.first_name, 'last_name', invite.last_name, 'role', invite.role),
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    new_user_id::text, new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', normalized_email, 'email_verified', true),
    'email', now(), now(), now()
  );
  return new_user_id;
end;
$$;

revoke all on function public.provision_imoflow_user(text, text) from public;
grant execute on function public.provision_imoflow_user(text, text) to authenticated;

create or replace function public.get_imoflow_client_portal_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  source_data jsonb := '{}'::jsonb;
  client_email text := '';
  contact_ids text[] := array[]::text[];
  seller_property_ids text[] := array[]::text[];
  process_ids text[] := array[]::text[];
  client_contacts jsonb := '[]'::jsonb;
  portal_properties jsonb := '[]'::jsonb;
  portal_processes jsonb := '[]'::jsonb;
  portal_documents jsonb := '[]'::jsonb;
begin
  select lower(email) into client_email
  from public.user_profiles
  where id = auth.uid()
    and role = 'Cliente'
    and status = 'active'
    and (blocked_until is null or blocked_until <= now());

  if client_email is null or client_email = '' then
    raise exception 'Acesso de cliente invalido';
  end if;

  select coalesce(data, '{}'::jsonb) into source_data
  from public.crm_state
  where id = 'main'
  limit 1;

  select
    coalesce(array_agg(contact->>'id'), array[]::text[]),
    coalesce(jsonb_agg(contact - 'notes' - 'statusHistory'), '[]'::jsonb)
  into contact_ids, client_contacts
  from jsonb_array_elements(coalesce(source_data->'contacts', '[]'::jsonb)) contact
  where lower(contact->>'email') = client_email;

  select coalesce(array_agg(property->>'id'), array[]::text[])
  into seller_property_ids
  from jsonb_array_elements(coalesce(source_data->'properties', '[]'::jsonb)) property
  where property->>'ownerId' = any(contact_ids);

  select coalesce(array_agg(process->>'id'), array[]::text[])
  into process_ids
  from jsonb_array_elements(coalesce(source_data->'processes', '[]'::jsonb)) process
  where process->>'sellerId' = any(contact_ids)
     or process->>'buyerId' = any(contact_ids);

  select coalesce(jsonb_agg(
    case
      when property->>'ownerId' = any(contact_ids) then
        (property
          - 'commission' - 'commissionMode' - 'commissionValue' - 'commissionFixedValue' - 'commissionPercentage'
          - 'notes' - 'responsibleConsultantId')
        || jsonb_build_object(
          'portalOwned', true,
          'activities', coalesce((
            select jsonb_agg(
              activity
                - 'grossCommission' - 'sharedCommission' - 'netCommission' - 'externalSharePercentage'
                - 'externalConsultantPhone' - 'externalConsultantEmail' - 'notes'
            )
            from jsonb_array_elements(coalesce(property->'activities', '[]'::jsonb)) activity
            where activity->>'type' in ('Visita', 'Proposta')
          ), '[]'::jsonb)
        )
      else jsonb_build_object(
        'id', property->>'id',
        'reference', property->>'reference',
        'type', property->>'type',
        'typology', property->>'typology',
        'status', property->>'status',
        'price', property->'price',
        'address', property->>'address',
        'city', property->>'city',
        'district', property->>'district',
        'county', property->>'county',
        'parish', property->>'parish',
        'postalCode', property->>'postalCode',
        'photoName', property->>'photoName',
        'photoData', property->>'photoData',
        'photoStored', coalesce(property->'photoStored', 'false'::jsonb),
        'portalOwned', false,
        'activities', '[]'::jsonb
      )
    end
  ), '[]'::jsonb)
  into portal_properties
  from jsonb_array_elements(coalesce(source_data->'properties', '[]'::jsonb)) property
  where property->>'ownerId' = any(contact_ids)
     or property->>'id' in (
       select process->>'propertyId'
       from jsonb_array_elements(coalesce(source_data->'processes', '[]'::jsonb)) process
       where process->>'id' = any(process_ids)
         and coalesce(process->>'propertyId', '') <> ''
     );

  select coalesce(jsonb_agg(
    (process
      - 'commission' - 'grossCommission' - 'sharedCommission' - 'externalSharePercentage'
      - 'externalCommissionMode' - 'externalCommissionFixedValue' - 'externalCommissionPercentage'
      - 'externalConsultantPhone' - 'externalConsultantEmail' - 'notes' - 'responsibleConsultantId')
    || jsonb_build_object(
      'portalRelation',
      case
        when process->>'sellerId' = any(contact_ids) and process->>'buyerId' = any(contact_ids) then 'Vendedor e Comprador'
        when process->>'sellerId' = any(contact_ids) then 'Vendedor'
        else 'Comprador'
      end
    )
  ), '[]'::jsonb)
  into portal_processes
  from jsonb_array_elements(coalesce(source_data->'processes', '[]'::jsonb)) process
  where process->>'id' = any(process_ids);

  select coalesce(jsonb_agg(document - 'notes'), '[]'::jsonb)
  into portal_documents
  from jsonb_array_elements(coalesce(source_data->'documents', '[]'::jsonb)) document
  where (
      (document->>'linkedType' = 'Imovel' or document->>'linkedType' like 'Im_vel')
      and document->>'linkedId' = any(seller_property_ids)
    )
    or (
      document->>'linkedType' = 'Processo'
      and document->>'linkedId' = any(process_ids)
    );

  return jsonb_build_object(
    'contacts', client_contacts,
    'properties', portal_properties,
    'processes', portal_processes,
    'documents', portal_documents,
    'tasks', '[]'::jsonb,
    'communications', '[]'::jsonb,
    'automation', '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_imoflow_client_portal_data() from public;
grant execute on function public.get_imoflow_client_portal_data() to authenticated;

create or replace function public.append_imoflow_client_document(p_document jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  source_data jsonb := '{}'::jsonb;
  client_email text := '';
  contact_ids text[] := array[]::text[];
  document_id text := trim(coalesce(p_document->>'id', ''));
  linked_type text := trim(coalesce(p_document->>'linkedType', ''));
  linked_id text := trim(coalesce(p_document->>'linkedId', ''));
  expected_file_key text := '';
  safe_document jsonb;
  allowed boolean := false;
begin
  select lower(email) into client_email
  from public.user_profiles
  where id = auth.uid()
    and role = 'Cliente'
    and status = 'active'
    and (blocked_until is null or blocked_until <= now());

  if client_email is null or document_id = '' or linked_id = ''
     or (linked_type <> 'Processo' and linked_type <> 'Imovel' and linked_type not like 'Im_vel') then
    raise exception 'Documento de cliente invalido';
  end if;
  if document_id !~ '^[a-zA-Z0-9_-]+$' then
    raise exception 'Identificador de documento invalido';
  end if;

  select coalesce(data, '{}'::jsonb) into source_data
  from public.crm_state
  where id = 'main'
  for update;

  select coalesce(array_agg(contact->>'id'), array[]::text[])
  into contact_ids
  from jsonb_array_elements(coalesce(source_data->'contacts', '[]'::jsonb)) contact
  where lower(contact->>'email') = client_email;

  if linked_type = 'Imovel' or linked_type like 'Im_vel' then
    select exists (
      select 1
      from jsonb_array_elements(coalesce(source_data->'properties', '[]'::jsonb)) property
      where property->>'id' = linked_id
        and property->>'ownerId' = any(contact_ids)
    ) into allowed;
  else
    select exists (
      select 1
      from jsonb_array_elements(coalesce(source_data->'processes', '[]'::jsonb)) process
      where process->>'id' = linked_id
        and (process->>'sellerId' = any(contact_ids) or process->>'buyerId' = any(contact_ids))
    ) into allowed;
  end if;

  if not allowed then
    raise exception 'Sem acesso ao registo associado';
  end if;

  expected_file_key := 'client/' || auth.uid()::text || '/' || document_id;
  safe_document := jsonb_build_object(
    'id', document_id,
    'name', left(coalesce(p_document->>'name', 'Documento do cliente'), 180),
    'category', case when linked_type = 'Processo' then 'Processo' else 'Imovel' end,
    'status', 'Recebido',
    'linkedType', linked_type,
    'linkedId', linked_id,
    'fileName', left(coalesce(p_document->>'fileName', 'documento'), 240),
    'fileStored', true,
    'fileType', left(coalesce(p_document->>'fileType', 'application/octet-stream'), 120),
    'fileKey', expected_file_key,
    'uploadedByClient', true,
    'uploadedBy', auth.uid()::text,
    'createdAt', now()::text,
    'updatedAt', now()::text
  );

  update public.crm_state
  set data = jsonb_set(
      coalesce(data, '{}'::jsonb),
      '{documents}',
      coalesce(data->'documents', '[]'::jsonb) || jsonb_build_array(safe_document),
      true
    ),
    updated_at = now(),
    updated_by = auth.uid()
  where id = 'main';

  return true;
end;
$$;

revoke all on function public.append_imoflow_client_document(jsonb) from public;
grant execute on function public.append_imoflow_client_document(jsonb) to authenticated;

create or replace function public.can_access_imoflow_client_file(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  source_data jsonb := '{}'::jsonb;
  client_email text := '';
  contact_ids text[] := array[]::text[];
  record_id text := '';
  linked_document jsonb;
begin
  select lower(email) into client_email
  from public.user_profiles
  where id = auth.uid()
    and role = 'Cliente'
    and status = 'active'
    and (blocked_until is null or blocked_until <= now());
  if client_email is null then return false; end if;

  if object_name like ('client/' || auth.uid()::text || '/%') then return true; end if;

  select coalesce(data, '{}'::jsonb) into source_data
  from public.crm_state
  where id = 'main'
  limit 1;

  select coalesce(array_agg(contact->>'id'), array[]::text[])
  into contact_ids
  from jsonb_array_elements(coalesce(source_data->'contacts', '[]'::jsonb)) contact
  where lower(contact->>'email') = client_email;

  if object_name like 'photo_%' then
    record_id := substring(object_name from 7);
    return exists (
      select 1 from jsonb_array_elements(coalesce(source_data->'properties', '[]'::jsonb)) property
      where property->>'id' = record_id and property->>'ownerId' = any(contact_ids)
    );
  end if;

  if object_name not like 'document_%' then return false; end if;
  record_id := substring(object_name from 10);
  select document into linked_document
  from jsonb_array_elements(coalesce(source_data->'documents', '[]'::jsonb)) document
  where document->>'id' = record_id
  limit 1;
  if linked_document is null then return false; end if;

  if linked_document->>'linkedType' = 'Imovel' or linked_document->>'linkedType' like 'Im_vel' then
    return exists (
      select 1 from jsonb_array_elements(coalesce(source_data->'properties', '[]'::jsonb)) property
      where property->>'id' = linked_document->>'linkedId' and property->>'ownerId' = any(contact_ids)
    );
  end if;
  if linked_document->>'linkedType' = 'Processo' then
    return exists (
      select 1 from jsonb_array_elements(coalesce(source_data->'processes', '[]'::jsonb)) process
      where process->>'id' = linked_document->>'linkedId'
        and (process->>'sellerId' = any(contact_ids) or process->>'buyerId' = any(contact_ids))
    );
  end if;
  return false;
end;
$$;

revoke all on function public.can_access_imoflow_client_file(text) from public;
grant execute on function public.can_access_imoflow_client_file(text) to authenticated;

create or replace function public.handle_imoflow_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.access_invites;
begin
  select *
  into invite
  from public.access_invites
  where lower(email) = lower(new.email)
  limit 1;

  if invite.email is null then
    insert into public.user_profiles (id, email, role, status)
    values (new.id, lower(new.email), 'Cliente', 'blocked')
    on conflict (id) do nothing;
  else
    insert into public.user_profiles (
      id, email, first_name, last_name, phone, role, company_function, status, created_by
    )
    values (
      new.id,
      lower(new.email),
      invite.first_name,
      invite.last_name,
      invite.phone,
      invite.role,
      invite.company_function,
      'active',
      invite.created_by
    )
    on conflict (id) do update set
      email = excluded.email,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      phone = excluded.phone,
      role = excluded.role,
      company_function = excluded.company_function,
      status = 'active',
      created_by = excluded.created_by,
      updated_at = now();

    delete from public.access_invites where lower(email) = lower(new.email);
  end if;

  return new;
end;
$$;

drop trigger if exists on_imoflow_user_created on auth.users;
create trigger on_imoflow_user_created
  after insert on auth.users
  for each row execute function public.handle_imoflow_user_created();

alter table public.user_profiles enable row level security;
alter table public.access_invites enable row level security;

drop policy if exists user_profiles_read on public.user_profiles;
drop policy if exists user_profiles_manage_insert on public.user_profiles;
drop policy if exists user_profiles_manage_update on public.user_profiles;
drop policy if exists user_profiles_manage_delete on public.user_profiles;
create policy user_profiles_read on public.user_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.can_view_imoflow_users()
    or (
      public.can_read_internal_crm()
      and role in ('Consultor Imobiliário', 'Consultor em Formação')
      and status = 'active'
      and (blocked_until is null or blocked_until <= now())
    )
  );
create policy user_profiles_manage_insert on public.user_profiles
  for insert to authenticated
  with check (public.can_manage_imoflow_users());
create policy user_profiles_manage_update on public.user_profiles
  for update to authenticated
  using (public.can_manage_imoflow_users())
  with check (public.can_manage_imoflow_users());
create policy user_profiles_manage_delete on public.user_profiles
  for delete to authenticated
  using (public.can_manage_imoflow_users());

drop policy if exists access_invites_manage on public.access_invites;
create policy access_invites_manage on public.access_invites
  for all to authenticated
  using (public.can_manage_imoflow_users())
  with check (public.can_manage_imoflow_users());

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'crm_state'
  loop
    execute format('drop policy if exists %I on public.crm_state', policy_row.policyname);
  end loop;
end $$;

create policy crm_state_read on public.crm_state
  for select to authenticated
  using (public.can_read_internal_crm());
create policy crm_state_insert on public.crm_state
  for insert to authenticated
  with check (public.can_write_internal_crm());
create policy crm_state_update on public.crm_state
  for update to authenticated
  using (public.can_write_internal_crm())
  with check (public.can_write_internal_crm());
create policy crm_state_delete on public.crm_state
  for delete to authenticated
  using (public.can_write_internal_crm());

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'imoflow_%'
  loop
    execute format('drop policy if exists %I on storage.objects', policy_row.policyname);
  end loop;
end $$;

create policy imoflow_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'imoflow-files'
    and (public.can_read_internal_crm() or public.can_access_imoflow_client_file(name))
  );
create policy imoflow_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'imoflow-files'
    and (
      public.can_write_internal_crm()
      or (
        public.is_active_imoflow_user()
        and (public.current_user_profile()).role = 'Cliente'
        and name like ('client/' || auth.uid()::text || '/%')
      )
    )
  );
create policy imoflow_files_update on storage.objects
  for update to authenticated
  using (bucket_id = 'imoflow-files' and public.can_write_internal_crm())
  with check (bucket_id = 'imoflow-files' and public.can_write_internal_crm());
create policy imoflow_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'imoflow-files' and public.can_write_internal_crm());

insert into public.user_profiles (id, email, first_name, last_name, role, company_function, status)
select id, lower(email), 'Miguel', 'Fidalgo', 'Admin', 'Administrador Master', 'active'
from auth.users
where lower(email) in ('mfidalgo@remax.pt', 'mig.fidalgo@gmail.com')
on conflict (id) do update set
  first_name = 'Miguel',
  last_name = 'Fidalgo',
  role = 'Admin',
  company_function = 'Administrador Master',
  status = 'active',
  blocked_until = null,
  updated_at = now();

update auth.users
set encrypted_password = crypt('Emergencia-1404', gen_salt('bf')),
    updated_at = now()
where lower(email) = 'mfidalgo@remax.pt';
