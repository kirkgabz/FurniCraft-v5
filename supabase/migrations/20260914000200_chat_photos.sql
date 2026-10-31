-- Photos in a shop-customer conversation.
--
-- Two halves, and both are needed before the paperclip does anything:
--
--   1. `shop_messages.kind` gains 'image'. A photo is a message, not an
--      attachment hanging off one -- it has a sender, a time and a place in the
--      thread like anything else -- so it is a row in the same table rather
--      than a second table to join and keep in step.
--   2. A private `chat-photos` bucket, read through signed URLs, the same shape
--      as payment-receipts. Deliberately NOT public: a customer photographing
--      the corner of their living room so a maker can size a cabinet has not
--      published that photo to the internet, and a public bucket URL never
--      expires and is guessable by anyone who sees one.
--
-- Path
-- ----
--   chat-photos  {shop_id}/{customer_user_id}/{timestamp}_{random}.{ext}
--
-- The first two segments ARE the conversation, which is what the policies key
-- on. Keying on {shop_id} alone would have let any customer of a shop read
-- every other customer's photos to it, so the second segment is not cosmetic:
-- changing these path builders without changing the policies below opens that
-- hole. See lib/chat-photos.ts, which is the only place that builds them, and
-- scripts/verify-chat-photos.mts, which checks the two still agree.
--
-- Safe to re-run: every statement is guarded.

-- ------------------------------------------------------------ the message
alter table public.shop_messages
  drop constraint if exists shop_messages_kind_check;
alter table public.shop_messages
  add constraint shop_messages_kind_check check (kind in ('text', 'image', 'order_event'));

-- A person may now type a message or send a photo. 'order_event' stays barred:
-- without that, a customer could still post a card claiming their order was
-- paid, which is the reason this policy names its kinds instead of trusting
-- the constraint above.
drop policy if exists "shop_messages_insert_own_text" on public.shop_messages;
create policy "shop_messages_insert_own_text" on public.shop_messages
  for insert to authenticated
  with check (sender_user_id = auth.uid() and kind in ('text', 'image'));

-- ------------------------------------------------------------- the bucket
insert into storage.buckets (id, name, public)
values ('chat-photos', 'chat-photos', false)
on conflict (id) do nothing;

-- Either side of the conversation: the customer whose id is the second path
-- segment, or the owner of the shop whose id is the first. Both may write and
-- read; nobody else can do either.
drop policy if exists "chat_photos_participants" on storage.objects;
create policy "chat_photos_participants" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'chat-photos'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1 from public.shops s
        where s.id::text = (storage.foldername(name))[1]
          and s.user_id = auth.uid()
      )
    )
  )
  with check (
    bucket_id = 'chat-photos'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1 from public.shops s
        where s.id::text = (storage.foldername(name))[1]
          and s.user_id = auth.uid()
      )
    )
  );

-- Read-only for admins, so a reported photo can actually be looked at. The
-- ticket queue can already read the message; without this it would show a
-- report about an image nobody moderating it can see.
drop policy if exists "chat_photos_read_admin" on storage.objects;
create policy "chat_photos_read_admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-photos' and public.is_admin());

-- ------------------------------------------------------------------ check
--   select id, public from storage.buckets where id = 'chat-photos';  -- f
--   select kind, count(*) from public.shop_messages group by 1;
-- A customer uploading into another customer's folder under the same shop
-- should be refused by chat_photos_participants.
