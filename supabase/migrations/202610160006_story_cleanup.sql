-- Story temizliği: süresi dolan story kayıtlarını ve storage.objects
-- kayıtlarını siler. storage.objects kaydı silinince public URL artık
-- 404 döner — süresi dolmuş görsele doğrudan linkle bile erişilemez.
-- 202610160005_stories.sql sonrasında çalıştırılır.

create or replace function public.purge_expired_stories()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  purged integer;
begin
  -- 1) Storage kayıtları: 24 saatten eski, aktif bir story'ye ait olmayan
  --    stories/ altındaki görseller (süresi dolmuş veya kaydı silinmiş).
  delete from storage.objects o
  where o.bucket_id = 'post-media'
    and o.name ~ '^[0-9a-fA-F-]{36}/stories/'
    and o.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.stories s
      where s.image_path = o.name
        and s.created_at > now() - interval '24 hours'
    );

  -- 2) Süresi dolan story satırları.
  delete from public.stories where created_at <= now() - interval '24 hours';
  get diagnostics purged = row_count;
  return purged;
end;
$$;
revoke all on function public.purge_expired_stories() from public;
grant execute on function public.purge_expired_stories() to authenticated;

notify pgrst, 'reload schema';
