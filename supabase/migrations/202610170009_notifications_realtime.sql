-- Bildirim realtime rozeti: notifications tablosu Realtime yayınına eklenir.
-- 202610170008_view_history.sql sonrasında çalıştırılır.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.notifications';
    exception when duplicate_object then null; end;
  end if;
end $$;

notify pgrst, 'reload schema';
