import { Suspense } from "react";
import type { Metadata } from "next";
import { Archivo, Bricolage_Grotesque, Martian_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { THEME_BOOT_SCRIPT } from "@/components/theme/theme-script";
import { LanguageProvider } from "@/components/language/language-provider";
import AuthLinkHandler from "@/components/auth/recovery-redirect";
import { NotificationToastProvider } from "@/components/notifications/notification-toast-provider";
import { NailCursor } from "@/components/cursor/nail-cursor";
import { SavedToast } from "@/components/notifications/saved-toast";
import HistoryDepth from "@/components/ui/history-depth";
import "./globals.css";

/**
 * The origin this app is served from, for absolute URLs in metadata.
 *
 * VERCEL_URL alone was wrong once a custom domain existed: it is the
 * per-deployment hostname (furnicraft-v4-a1b2c3.vercel.app), which changes on
 * every push and is not where anyone visits. The production domain is checked
 * first, and NEXT_PUBLIC_SITE_URL overrides both for anything self-hosted.
 *
 * This does not affect auth email links. Those are built by Supabase from the
 * project's own Site URL setting -- see the README.
 */
const defaultUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "FurniCraft",
  description: "The Customizable Furniture Design Platform",
};

/**
 * Type for the solihiya world.
 *
 * This replaces DM Sans + Playfair Display, which were never a decision: the
 * stylesheet asked for them, nothing loaded them, and headings silently fell
 * back to Times. They are also the two faces most reliably reached for by
 * default, which is the other reason they are gone.
 *
 * Bricolage Grotesque carries display. Its optical-size axis makes the same
 * word sit differently at 16px and 96px, so the lettering reads built rather
 * than scaled -- the right register for a surface about handwoven work.
 * Archivo carries body copy and UI. Martian Mono is reserved for measurement:
 * centimetres, peso amounts, order ids. Monospace here is data, never costume.
 */
const bricolage = Bricolage_Grotesque({
  variable: "--font-display",
  display: "swap",
  subsets: ["latin"],
});

const archivo = Archivo({
  variable: "--font-sans",
  display: "swap",
  subsets: ["latin"],
});

const martianMono = Martian_Mono({
  variable: "--font-mono",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${bricolage.variable} ${archivo.variable} ${martianMono.variable} ${archivo.className} antialiased`}
      >
        {/* Renders nothing. It stamps each history entry with how deep into
            the app it is, which is what lets a Back button tell "go back one
            page" from "there is nothing of ours behind this tab". Mounted
            here because the count has to advance on every navigation, not
            only on the pages that show a Back button, including hash-only
            section changes. */}
        <Suspense fallback={null}>
          <HistoryDepth />
        </Suspense>

        {/* The direction contract for this redesign, emitted into the built
            markup so it can be audited after a production build rather than
            living only in source. Grep the output for the seed key. */}
        <div
          hidden
          dangerouslySetInnerHTML={{
            __html: `<!--
IMPECCABLE DIRECTION CONTRACT

THESIS: FurniCraft is a caned panel you operate. The solihiya lattice is the
layout itself, and every step of a commission is a woven cell you can read back
along. Refuses the warm-cream artisanal-furniture landing and the product-grid
storefront it always ships with.

OWN-WORLD: Openwork against shadow. Near-black kamagong ground, straw cane
drawn as real woven mesh rather than a texture, one lacquer red rationed to
live actions. Hardwood frame rules instead of cards. Bricolage Grotesque
display, Archivo body, Martian Mono for measurement only.

STORY: A first-timer understands they can operate this themselves, believes a
real Philippine furniture shop will build it, and opens the studio.

FIRST VIEWPORT (superseded, see amendment below): Full-bleed cane mesh over
black; the chair lit inside the lattice at two-thirds viewport height;
centimetre readout in mono at its edge; the primary action seated in the
lattice's centre cell.

FORM: Solihiya Lattice, candidate 1 of 7, taken as Impeccable's Pick over
assigned index 5. Seed key e98c17cd.

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance.

AMENDMENT: the landing hero and the auth (sign in / sign up / password reset)
sequence were redirected from Solihiya Lattice to a second world, Furniture shop
Ledger, by direct request rather than a fresh Impeccable candidate run --
there is no new seed key for it. THESIS holds unchanged for the rest of the
product: the commission steps, the dashboard and the furniture-type picker
still read as the caned panel described above. Furniture Shop Ledger's own
first-viewport: paper ground, ink text, a faint drafting grid, a dimensioned
line drawing standing in for the product photo, its outline and dimensions
drawing themselves in on load, a brass ink stamp landing last. See
components/landing/ledger-hero.tsx and the .ledger-* rules in app/globals.css.
-->`,
          }}
        />
        {/* Applies the saved theme before first paint.

            The script is written as raw inner HTML rather than as a <script>
            element of its own, and that is load-bearing. React warns -- fairly --
            whenever it creates a script element on the client, since a script
            created that way never executes. It does exactly that to the shell on
            any path where it client-renders instead of hydrating, which includes
            a dynamic route calling notFound(), i.e. /admin for a non-admin.
            Raw inner HTML produces no script fiber, so there is nothing for
            React to re-create, while the server-rendered markup is still parsed
            and executed normally.

            It sits first in <body> so it runs before the page below it paints. */}
        <div hidden dangerouslySetInnerHTML={{ __html: `<script>${THEME_BOOT_SCRIPT}</script>` }} />
        {/* Any emailed auth link that lands on the wrong page -- confirm, magic
            link, reset, email change -- is completed here. Nothing else on a
            page like "/" ever reads the fragment. */}
        <ThemeProvider>
          <LanguageProvider>
            <AuthLinkHandler />
            {/* The FAQ used to be mounted here, so it floated over every page
                in the app -- the studio, the checkout, an order thread. It now
                belongs to the customer dashboard's Overview, which is where
                someone is actually browsing rather than mid-task, and is
                rendered there instead -- and on the public front page, for
                the same reason. */}
            <NotificationToastProvider>{children}</NotificationToastProvider>
            {/* The pointer itself, and the hammer blow every click and tap
                lands. Mounted at the root so the tool is the same one in the
                studio, the checkout and an order thread -- a cursor that
                changes hands between pages is a cursor nobody trusts. It sits
                inside the theme provider only so it is torn down with the rest
                of the tree; it reads its colours from the tokens on <html>. */}
            <NailCursor />
            <SavedToast />
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
