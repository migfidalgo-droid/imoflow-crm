-- Execute uma vez no SQL Editor do Supabase para ativar o novo perfil.

alter table public.user_profiles
  drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
  add constraint user_profiles_role_check check (role in (
    'Admin',
    'Broker',
    'Coordenadora de Agência',
    'Consultor Imobiliário',
    'Consultor em Formação',
    'Diretor de Agência',
    'Recrutador',
    'Gestor de Marketing',
    'Cliente'
  ));

alter table public.access_invites
  drop constraint if exists access_invites_role_check;

alter table public.access_invites
  add constraint access_invites_role_check check (role in (
    'Admin',
    'Broker',
    'Coordenadora de Agência',
    'Consultor Imobiliário',
    'Consultor em Formação',
    'Diretor de Agência',
    'Recrutador',
    'Gestor de Marketing',
    'Cliente'
  ));

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

drop policy if exists user_profiles_read on public.user_profiles;
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
