-- A signed-in customer's chosen display language, so it follows them across
-- devices the same way their theme does not (theme is deliberately
-- per-browser, in localStorage only -- language is a language, not a
-- rendering preference, so it belongs on the account).

alter table public.user_profiles
  add column if not exists language text not null default 'en'
    check (language in ('en', 'fil'));
