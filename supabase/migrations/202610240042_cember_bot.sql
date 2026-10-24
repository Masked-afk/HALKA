-- Çember bot mesajları: is_bot bayrağı.
alter table public.messages
  add column if not exists is_bot boolean not null default false;
alter table public.community_channel_messages
  add column if not exists is_bot boolean not null default false;
notify pgrst, 'reload schema';
