-- Düzeltme paketi: bölüm beğenilerini anon okura aç (eser beğenileriyle aynı kural),
-- taslak bölümlere ait yorumları bölümle birlikte gizle.
-- 202610170033_invite_link_table.sql sonrasında çalıştırılır.

-- ═══════════ 1) chapter_likes okuması: anon + authenticated ═══════════
-- public.likes ile aynı davranış: giriş yapmayan okur da beğeni sayısını görür.
grant select on public.chapter_likes to anon;

drop policy if exists "Readers see chapter likes" on public.chapter_likes;
create policy "Readers see chapter likes"
  on public.chapter_likes for select to anon, authenticated
  using (exists (
    select 1 from public.chapters ch
    join public.posts p on p.id = ch.post_id
    where ch.id = chapter_id
      and (not coalesce(ch.is_draft, false) or p.author_id = auth.uid())
  ));

-- ═══════════ 2) Taslak bölüm yorumlarını gizle ═══════════
-- Restrictive kapı: yorum, görünür olmayan (taslak) bir bölüme aitse gösterilmez.
-- Bölümsüz eser yorumları (chapter_id null) etkilenmez.
drop policy if exists "Hide comments on draft chapters" on public.comments;
create policy "Hide comments on draft chapters"
  on public.comments as restrictive for select to public
  using (
    (chapter_id is null
      or exists (
        select 1 from public.chapters ch
        where ch.id = comments.chapter_id
          and (not ch.is_draft
            or public.is_post_author(ch.post_id)
            or exists (select 1 from public.posts p where p.id = ch.post_id and public.has_beta_access(p.id)))))
    and (parent_comment_id is null
      or exists (
        select 1 from public.comments pc
        left join public.chapters pch on pch.id = pc.chapter_id
        where pc.id = comments.parent_comment_id
          and (pc.chapter_id is null
            or not pch.is_draft
            or public.is_post_author(pch.post_id)
            or exists (select 1 from public.posts p where p.id = pch.post_id and public.has_beta_access(p.id)))))
  );

notify pgrst, 'reload schema';
