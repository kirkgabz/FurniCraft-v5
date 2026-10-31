
import { UiText } from "@/components/language/ui-text";
// Reads the template on every request -- the same convention /shops and
// /protected use -- so a template the shop hides stops opening at once.
export const instant = false;

import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSharedTemplate } from "@/lib/shops/shared-template";
import SharedTemplateView from "@/components/shops/shared-template-view";

/**
 * A shop's template, opened from a shared link.
 *
 * Public: the proxy lets /t/ through without a session, so the link works
 * pasted anywhere. Seeing the piece needs no account; ordering it does, and
 * the page asks for a sign-in only at that point.
 *
 * The template is read on the server (see loadSharedTemplate for the rules it
 * applies), so nothing about templates is opened up to the browser in general.
 */

// generateMetadata and the page both need the row; one read serves both.
const load = cache(loadSharedTemplate);

export async function generateMetadata({ params }: { params: Promise<{ templateId: string }> }): Promise<Metadata> {
  const { templateId } = await params;
  const result = await load(templateId);
  if (result.kind !== "found") return { title: "Template | FurniCraft" };
  const { template } = result;
  const title = `${template.title} by ${template.shop.name} | FurniCraft`;
  const description = template.description || `Open ${template.title} in 3D and order it from ${template.shop.name}.`;
  // A link preview needs an address it can fetch; a stored data: URL is not one.
  const image = template.previewUrl?.startsWith("http") ? template.previewUrl : null;
  return {
    title,
    description,
    openGraph: { title, description, ...(image ? { images: [image] } : {}) },
  };
}

export default async function SharedTemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const result = await load(templateId);

  if (result.kind === "unconfigured") {
    return (
      <main className="grid min-h-dvh place-items-center bg-[var(--fc-bg)] px-4 text-[var(--fc-text)]">
        <div className="max-w-md text-center">
          <h1 className="font-display text-2xl font-bold"><UiText text="Shared links aren’t set up yet" /></h1>
          <p className="mt-2 text-sm text-[var(--fc-muted)]"><UiText text="This template can’t be shown here right now. Sign in to FurniCraft to find it in the shop’s templates." /></p>
          <a href="/auth/login" className="btn btn-primary mt-5 inline-flex"><UiText text="Sign in" /></a>
        </div>
      </main>
    );
  }
  if (result.kind === "missing") notFound();

  return <SharedTemplateView template={result.template} />;
}
