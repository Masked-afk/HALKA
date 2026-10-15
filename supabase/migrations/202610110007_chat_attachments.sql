-- Private chat attachments: images, short videos, and PDFs.
alter table public.messages
  add column if not exists attachment_path text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_name text;

alter table public.messages
  drop constraint if exists messages_body_or_post,
  add constraint messages_body_post_or_attachment
    check (length(trim(body)) > 0 or shared_post_id is not null or attachment_path is not null),
  add constraint messages_attachment_metadata
    check (
      (attachment_path is null and attachment_mime is null and attachment_name is null)
      or (
        attachment_path is not null
        and length(attachment_path) <= 500
        and attachment_mime is not null
        and attachment_mime in (
          'image/jpeg', 'image/png', 'image/webp', 'image/gif',
          'video/mp4', 'video/webm', 'application/pdf'
        )
        and attachment_name is not null
        and length(attachment_name) between 1 and 255
      )
    );

drop policy if exists "Members can send messages" on public.messages;
create policy "Members can send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
    and (
      attachment_path is null
      or attachment_path like conversation_id::text || '/' || auth.uid()::text || '/%'
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media', 'chat-media', false, 26214400,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Conversation members can view chat media" on storage.objects;
create policy "Conversation members can view chat media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "Conversation members can upload their chat media" on storage.objects;
create policy "Conversation members can upload their chat media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "Senders can remove their chat media" on storage.objects;
create policy "Senders can remove their chat media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
  );

notify pgrst, 'reload schema';
