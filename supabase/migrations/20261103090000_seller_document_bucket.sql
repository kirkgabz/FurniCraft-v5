-- Seller onboarding uploads here before creating a pending shop. Policies
-- were added in 20260824000200, but the bucket itself was never provisioned.
-- Preserve the documented private access: only the applicant and admins read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'seller-documents', 'seller-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set public = false;
