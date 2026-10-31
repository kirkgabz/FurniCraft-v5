-- Filipino translation was removed from the app, so nothing reads or writes
-- the cache and quota from 20261024000100 any more. The quota function goes
-- with its table: left behind, it would fail on its first call.
drop function if exists public.take_translation_quota();
drop table if exists public.translation_quotas;
drop table if exists public.filipino_translations;
