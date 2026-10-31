-- Whether a customer wants an email when their furniture is marked ready for
-- pickup, alongside the in-app notification that already fires for every
-- order status change. Defaults to on: this is a transactional email a
-- customer is waiting on, not marketing, so opt-out (not opt-in) is the
-- honest default -- the same choice every shipping/order-ready email in
-- e-commerce makes. Scoped to this one event rather than a general "email
-- notifications" flag, because that's the only email this app sends; a
-- second one would earn a second column, not a shared one that quietly
-- covers something the customer never agreed to.
alter table public.user_profiles
  add column if not exists email_notify_order_ready boolean not null default true;
