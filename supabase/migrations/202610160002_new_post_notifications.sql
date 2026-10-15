-- Takip edilen yazar yeni eser yayımladığında takipçilere bildirim.
-- 202610160001_community_channels.sql sonrasında çalıştırılır.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','comment','reply','friend_request','friend_accept','message','follow','badge','new_post'));

create or replace function public.notify_followers_on_post()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, post_id)
  select f.follower_id, new.author_id, 'new_post', new.id
  from public.follows f
  where f.followed_id = new.author_id
    and f.follower_id <> new.author_id
  limit 500;
  return new;
end;
$$;
revoke all on function public.notify_followers_on_post() from public;

drop trigger if exists trg_notify_new_post on public.posts;
create trigger trg_notify_new_post after insert on public.posts
  for each row execute function public.notify_followers_on_post();

notify pgrst, 'reload schema';
