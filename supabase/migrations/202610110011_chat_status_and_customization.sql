alter table public.profiles
  add column if not exists last_active_at timestamptz;

alter table public.messages
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz;

drop policy if exists "Senders can update message status" on public.messages;
create policy "Senders can update message status"
  on public.messages for update to authenticated
  using (auth.uid() = sender_id)
  with check (auth.uid() = sender_id);

drop policy if exists "Receivers can mark messages as read" on public.messages;
create policy "Receivers can mark messages as read"
  on public.messages for update to authenticated
  using (
    auth.uid() <> sender_id
    and public.is_conversation_member(conversation_id)
  )
  with check (
    auth.uid() <> sender_id
    and public.is_conversation_member(conversation_id)
  );

grant update(delivered_at, read_at) on public.messages to authenticated;

alter table public.conversations
  add column if not exists theme_color text default null,
  add column if not exists wallpaper text default null,
  add column if not exists custom_title text default null;

alter table public.conversations
  drop constraint if exists conversations_theme_color_check,
  add constraint conversations_theme_color_check
    check (theme_color is null or theme_color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.conversations
  drop constraint if exists conversations_custom_title_check,
  add constraint conversations_custom_title_check
    check (custom_title is null or length(custom_title) <= 80);

drop policy if exists "Conversation members can update customization" on public.conversations;
create policy "Conversation members can update customization"
  on public.conversations for update to authenticated
  using (public.is_conversation_member(id))
  with check (public.is_conversation_member(id));

grant update(theme_color, wallpaper, custom_title) on public.conversations to authenticated;

notify pgrst, 'reload schema';
