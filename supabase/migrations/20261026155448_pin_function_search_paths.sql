-- Pin the search_path of the last two functions that left it to the caller.
--
-- A function without a fixed search_path resolves names through whatever path
-- the calling role has set, so a role that can create objects earlier on that
-- path can swap in its own (database linter 0011). Neither body names anything
-- outside pg_catalog -- one calls now(), the other returns constants -- so an
-- empty path changes nothing they do.
--
-- Safe to re-run.

alter function public.touch_customer_design_updated_at() set search_path = '';
alter function public.subscription_plan() set search_path = '';
