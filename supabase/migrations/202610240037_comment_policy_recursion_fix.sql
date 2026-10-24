-- Düzeltme: "Hide comments on draft chapters" politikası kendi tablosunu sorguladığı için
-- INSERT ... RETURNING sırasında "infinite recursion" veriyordu.
-- Mantığı SECURITY DEFINER fonksiyona taşıyıp RLS zincirini kırıyoruz.
-- 202610240036_gif_comments.sql sonrasında çalıştırılır.

create or replace function public.is_comment_visible(p_chapter_id uuid, p_parent_id bigint)
returns boolean
language sql security definer stable
set search_path = ''
as $$
  select
    (p_chapter_id is null
      or exists (
        select 1 from public.chapters ch
        left join public.posts p on p.id = ch.post_id
        where ch.id = p_chapter_id
          and (not ch.is_draft
            or p.author_id = auth.uid()
            or public.has_beta_access(ch.post_id))))
    and
    (p_parent_id is null
      or exists (
        select 1 from public.comments pc
        left join public.chapters pch on pch.id = pc.chapter_id
        left join public.posts pp on pp.id = pch.post_id
        where pc.id = p_parent_id
          and (pc.chapter_id is null
            or not pch.is_draft
            or pp.author_id = auth.uid()
            or public.has_beta_access(pch.post_id))));
$$;

revoke all on function public.is_comment_visible(uuid, bigint) from public;
grant execute on function public.is_comment_visible(uuid, bigint) to anon, authenticated;

drop policy if exists "Hide comments on draft chapters" on public.comments;
create policy "Hide comments on draft chapters"
  on public.comments as restrictive for select to public
  using (public.is_comment_visible(chapter_id, parent_comment_id));

notify pgrst, 'reload schema';
