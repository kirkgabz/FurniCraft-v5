/**
 * Pass-through. Both pages under /protected -- the customer dashboard and the
 * shop dashboard -- render their own full-height shell, with a sticky header,
 * a sidebar and their own spacing. This used to be the Supabase starter chrome:
 * a centred max-w-[1600px] wrapper with padding and a "Powered by Supabase"
 * footer, which boxed each dashboard in and left a margin down both sides.
 */
export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
