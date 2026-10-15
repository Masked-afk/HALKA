-- Düzeltme: trg_enforce_created_at trigger'ı created_at kolonu olmayan
-- tablolarda (conversation_members, community_members vb.) insert'leri
-- "record new has no field created_at" hatasıyla bozuyordu.
-- Fonksiyon artık kolonun varlığını kontrol eder; joined_at'i de korur.
-- 202610150002_search_and_reading_progress.sql sonrasında çalıştırılır.

create or replace function public.enforce_created_at()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) ? 'created_at') then
    new.created_at := case when tg_op = 'INSERT' then now() else old.created_at end;
  end if;
  if (to_jsonb(new) ? 'joined_at') then
    new.joined_at := case when tg_op = 'INSERT' then now() else old.joined_at end;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
