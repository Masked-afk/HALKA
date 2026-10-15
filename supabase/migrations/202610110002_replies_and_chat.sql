-- Replies, private and group conversations, and sharing posts in chat.
alter table public.comments
  add column if not exists parent_comment_id bigint
  references public.comments(id) on delete cascade;

create index if not exists comments_parent_comment_id_idx
  on public.comments(parent_comment_id);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  title text,
  is_group boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  shared_post_id uuid references public.posts(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint messages_body_or_post check (length(trim(body)) > 0 or shared_post_id is not null),
  constraint messages_body_length check (length(body) <= 4000)
);

create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at desc);
create index if not exists conversation_members_user_idx
  on public.conversation_members(user_id, conversation_id);

create or replace function public.is_conversation_member(target_conversation uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = target_conversation and cm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

create or replace function public.create_conversation(target_members uuid[], conversation_title text default null)
returns uuid language plpgsql security definer set search_path = public, auth
as $$
declare
  new_conversation_id uuid;
  participant_ids uuid[];
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  participant_ids := array(
    select distinct participant_id
    from unnest(coalesce(target_members, '{}'::uuid[]) || array[auth.uid()]) as members(participant_id)
    where participant_id is not null
  );
  if cardinality(participant_ids) < 2 then raise exception 'En az bir kişi seçmelisin.'; end if;
  if cardinality(participant_ids) > 20 then raise exception 'Bir grupta en fazla 20 kişi olabilir.'; end if;
  if length(trim(coalesce(conversation_title, ''))) > 80 then raise exception 'Grup adı en fazla 80 karakter olabilir.'; end if;

  insert into public.conversations (created_by, title, is_group)
  values (
    auth.uid(),
    case when cardinality(participant_ids) > 2 then nullif(trim(conversation_title), '') else null end,
    cardinality(participant_ids) > 2
  )
  returning id into new_conversation_id;

  insert into public.conversation_members (conversation_id, user_id)
  select new_conversation_id, participant_id from unnest(participant_ids) as members(participant_id);

  return new_conversation_id;
end;
$$;

revoke all on function public.create_conversation(uuid[], text) from public;
grant execute on function public.create_conversation(uuid[], text) to authenticated;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Conversation members can read conversations" on public.conversations;
create policy "Conversation members can read conversations"
  on public.conversations for select to authenticated
  using (public.is_conversation_member(id) or created_by = auth.uid());

drop policy if exists "Users can create conversations" on public.conversations;
create policy "Users can create conversations"
  on public.conversations for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "Participants can read conversation members" on public.conversation_members;
create policy "Participants can read conversation members"
  on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id) or user_id = auth.uid());

drop policy if exists "Creators can add conversation members" on public.conversation_members;
drop policy if exists "Users can add themselves to conversations" on public.conversation_members;
create policy "Users can add themselves to conversations"
  on public.conversation_members for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Members can read conversation messages" on public.messages;
create policy "Members can read conversation messages"
  on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "Members can send messages" on public.messages;
create policy "Members can send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

grant select on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
revoke insert on public.conversations, public.conversation_members from authenticated;
grant select, insert on public.messages to authenticated;

-- Authors may reply through the existing comments table and may edit their own comments.
drop policy if exists "Authors can edit their own comments" on public.comments;
create policy "Authors can edit their own comments"
  on public.comments for update to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);
