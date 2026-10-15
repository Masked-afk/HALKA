-- Store one like per user and comment. The public view exposes counts only;
-- direct access to liker IDs remains limited to the signed-in user.
create table if not exists public.comment_likes (
  comment_id bigint not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_likes enable row level security;

drop policy if exists "Users can read their own comment likes" on public.comment_likes;
create policy "Users can read their own comment likes"
  on public.comment_likes for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can like comments as themselves" on public.comment_likes;
create policy "Users can like comments as themselves"
  on public.comment_likes for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their own comment likes" on public.comment_likes;
create policy "Users can remove their own comment likes"
  on public.comment_likes for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.comment_likes to authenticated;

drop policy if exists "Authors can edit their own comments" on public.comments;
create policy "Authors can edit their own comments"
  on public.comments for update to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

create or replace view public.comment_like_counts as
  select comment_id, count(*)::bigint as like_count
  from public.comment_likes
  group by comment_id;

grant select on public.comment_like_counts to anon, authenticated;
