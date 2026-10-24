-- Etkileşim paketi: okur oylamalı bölüm anketleri, paragraf ısı haritası,
-- ilham/remix zinciri, emoji tepkileri, sesli yorum.
-- 202610170034_chapter_like_and_comment_visibility.sql sonrasında çalıştırılır.

-- ═══════════ 1) İlham/remix zinciri ═══════════
alter table public.posts
  add column if not exists inspired_by uuid references public.posts(id) on delete set null;
create index if not exists posts_inspired_by_idx
  on public.posts (inspired_by) where inspired_by is not null;

-- ═══════════ 2) Okur oylamalı bölüm anketleri ═══════════
create table if not exists public.chapter_polls (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  options jsonb not null default '[]',
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists chapter_polls_chapter_uidx on public.chapter_polls (chapter_id);
alter table public.chapter_polls enable row level security;
grant select, insert, update on public.chapter_polls to authenticated;
grant select on public.chapter_polls to anon;

create table if not exists public.chapter_poll_votes (
  poll_id uuid not null references public.chapter_polls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  option_index int not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);
alter table public.chapter_poll_votes enable row level security;
grant select, insert, delete on public.chapter_poll_votes to authenticated;
grant select on public.chapter_poll_votes to anon;

-- anket görünürlüğü = bölüm görünürlüğü (taslak: yazar + beta okur)
drop policy if exists "Polls readable" on public.chapter_polls;
create policy "Polls readable"
  on public.chapter_polls for select to anon, authenticated
  using (exists (
    select 1 from public.chapters ch
    where ch.id = chapter_id
      and (not ch.is_draft
        or public.is_post_author(ch.post_id)
        or exists (select 1 from public.posts p where p.id = ch.post_id and public.has_beta_access(p.id)))));

drop policy if exists "Authors manage polls" on public.chapter_polls;
create policy "Authors manage polls"
  on public.chapter_polls for insert to authenticated
  with check (public.is_post_author(post_id));
create policy "Authors update polls"
  on public.chapter_polls for update to authenticated
  using (public.is_post_author(post_id))
  with check (public.is_post_author(post_id));

drop policy if exists "Poll votes readable" on public.chapter_poll_votes;
create policy "Poll votes readable"
  on public.chapter_poll_votes for select to anon, authenticated
  using (exists (
    select 1 from public.chapter_polls pl
    join public.chapters ch on ch.id = pl.chapter_id
    where pl.id = poll_id
      and (not ch.is_draft
        or public.is_post_author(ch.post_id)
        or exists (select 1 from public.posts p where p.id = ch.post_id and public.has_beta_access(p.id)))));

drop policy if exists "Readers vote polls" on public.chapter_poll_votes;
create policy "Readers vote polls"
  on public.chapter_poll_votes for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.chapter_polls pl
      join public.chapters ch on ch.id = pl.chapter_id
      where pl.id = poll_id and pl.closed_at is null
        and (not ch.is_draft
          or public.is_post_author(ch.post_id)
          or exists (select 1 from public.posts p where p.id = ch.post_id and public.has_beta_access(p.id))))
  );

drop policy if exists "Users unvote polls" on public.chapter_poll_votes;
create policy "Users unvote polls"
  on public.chapter_poll_votes for delete to authenticated
  using (user_id = auth.uid());

-- ═══════════ 3) Paragraf ısı haritası ═══════════
create table if not exists public.paragraph_dwell (
  post_id uuid not null references public.posts(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  paragraph_index int not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  seconds numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (post_id, chapter_id, paragraph_index, user_id)
);
alter table public.paragraph_dwell enable row level security;
grant select, insert, update on public.paragraph_dwell to authenticated;

drop policy if exists "Users write own dwell" on public.paragraph_dwell;
create policy "Users write own dwell"
  on public.paragraph_dwell for insert to authenticated
  with check (user_id = auth.uid());
create policy "Users update own dwell"
  on public.paragraph_dwell for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Author reads dwell" on public.paragraph_dwell;
create policy "Author reads dwell"
  on public.paragraph_dwell for select to authenticated
  using (user_id = auth.uid() or public.is_post_author(post_id));

-- toplu dwell yazımı (tek RPC, çakışmada toplar)
create or replace function public.bump_dwells(p_rows jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.paragraph_dwell (post_id, chapter_id, paragraph_index, user_id, seconds, updated_at)
  select (r->>'post_id')::uuid, (r->>'chapter_id')::uuid, (r->>'paragraph_index')::int,
         auth.uid(), greatest(0, coalesce((r->>'seconds')::numeric, 0)), now()
  from jsonb_array_elements(p_rows) r
  on conflict (post_id, chapter_id, paragraph_index, user_id)
  do update set seconds = public.paragraph_dwell.seconds + excluded.seconds,
                updated_at = now();
end;
$$;
revoke all on function public.bump_dwells(jsonb) from public;
grant execute on function public.bump_dwells(jsonb) to authenticated;

-- ═══════════ 4) Emoji tepkileri ═══════════
create table if not exists public.comment_reactions (
  comment_id bigint not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, emoji)
);
create table if not exists public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);
alter table public.comment_reactions enable row level security;
alter table public.post_reactions enable row level security;
grant select, insert, delete on public.comment_reactions to authenticated;
grant select, insert, delete on public.post_reactions to authenticated;
grant select on public.comment_reactions to anon;
grant select on public.post_reactions to anon;

create policy "Everyone reads comment reactions" on public.comment_reactions
  for select to public using (true);
create policy "Users add own comment reactions" on public.comment_reactions
  for insert to authenticated with check (user_id = auth.uid());
create policy "Users remove own comment reactions" on public.comment_reactions
  for delete to authenticated using (user_id = auth.uid());

create policy "Everyone reads post reactions" on public.post_reactions
  for select to public using (true);
create policy "Users add own post reactions" on public.post_reactions
  for insert to authenticated with check (user_id = auth.uid());
create policy "Users remove own post reactions" on public.post_reactions
  for delete to authenticated using (user_id = auth.uid());

-- ═══════════ 5) Sesli yorum ═══════════
alter table public.comments
  add column if not exists audio_path text,
  add column if not exists audio_seconds int;

-- post-media bucket'a ses türlerini ekle (mevcut listeyi koruyarak birleştir)
update storage.buckets
  set allowed_mime_types = (
    select array_agg(distinct m) from unnest(
      coalesce(allowed_mime_types, array[]::text[])
      || array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav']
    ) m
  )
  where id = 'post-media';

notify pgrst, 'reload schema';
