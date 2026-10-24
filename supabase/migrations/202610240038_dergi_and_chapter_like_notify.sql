-- Kolektif dergi/sayı + bölüm beğenisi bildirimi.
-- 202610240037_comment_policy_recursion_fix.sql sonrasında çalıştırılır.

-- ═══════════ 1) Bölüm beğenisi bildirimi ═══════════
-- likes tetikleyicisiyle aynı desen: post_id çözülür, 'like' tipiyle eklenir.
create or replace function public.notify_on_chapter_like()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  target uuid;
  pid uuid;
begin
  select ch.post_id into pid from public.chapters ch where ch.id = new.chapter_id;
  select p.author_id into target from public.posts p where p.id = pid;
  if target is null or target = new.user_id then return new; end if;
  if not exists (
    select 1 from public.notifications n
    where n.user_id = target and n.actor_id = new.user_id
      and n.type = 'like' and n.post_id = pid and n.read_at is null
  ) then
    insert into public.notifications (user_id, actor_id, type, post_id)
    values (target, new.user_id, 'like', pid);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_chapter_like on public.chapter_likes;
create trigger trg_notify_chapter_like
  after insert on public.chapter_likes
  for each row execute function public.notify_on_chapter_like();

-- ═══════════ 2) Kolektif dergi/sayı ═══════════
create table if not exists public.joint_issues (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.joint_issues enable row level security;
grant select, insert, update, delete on public.joint_issues to authenticated;
grant select on public.joint_issues to anon;

create policy "Published issues readable" on public.joint_issues
  for select to public using (is_published or creator_id = auth.uid());
create policy "Users create issues" on public.joint_issues
  for insert to authenticated with check (creator_id = auth.uid());
create policy "Creators manage issues" on public.joint_issues
  for update to authenticated using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy "Creators delete issues" on public.joint_issues
  for delete to authenticated using (creator_id = auth.uid());

create table if not exists public.issue_posts (
  issue_id uuid not null references public.joint_issues(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  position int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  added_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id, post_id)
);
alter table public.issue_posts enable row level security;
grant select, insert, update, delete on public.issue_posts to authenticated;
grant select on public.issue_posts to anon;

-- görünürlük: yayınlanmış sayıda kabul edilmişler herkese;
-- bekleyenler yalnızca küratör ve ekleyene
create policy "Issue posts readable" on public.issue_posts
  for select to public using (
    exists (
      select 1 from public.joint_issues i
      where i.id = issue_id
        and (i.creator_id = auth.uid()
          or (i.is_published and status = 'accepted')))
    or added_by = auth.uid()
  );

-- ekleme: kendi eserini öneren üye veya küratör
create policy "Members submit posts" on public.issue_posts
  for insert to authenticated
  with check (
    added_by = auth.uid()
    and (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
      or exists (select 1 from public.joint_issues i where i.id = issue_id and i.creator_id = auth.uid()))
  );

-- kabul/sıralama: küratör; silme: küratör veya ekleyen
create policy "Creators curate posts" on public.issue_posts
  for update to authenticated
  using (exists (select 1 from public.joint_issues i where i.id = issue_id and i.creator_id = auth.uid()))
  with check (exists (select 1 from public.joint_issues i where i.id = issue_id and i.creator_id = auth.uid()));
create policy "Creators or submitters remove" on public.issue_posts
  for delete to authenticated
  using (added_by = auth.uid()
    or exists (select 1 from public.joint_issues i where i.id = issue_id and i.creator_id = auth.uid()));

notify pgrst, 'reload schema';
