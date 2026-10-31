type TemplateDetails = { title: string; tag: string; description: string };
type ExistingDetails = { tag?: string | null; description?: string | null };

/** Older templates may lack metadata. Updating stock must not require inventing it. */
export function validateTemplateDetails(details: TemplateDetails, existing?: ExistingDetails | null) {
  const required = {
    tag: !existing || Boolean(existing.tag?.trim()),
    description: !existing || Boolean(existing.description?.trim()),
  };
  const missing = [
    !details.title.trim() && "Title",
    required.tag && !details.tag.trim() && "Tag",
    required.description && !details.description.trim() && "Description",
  ].filter((field): field is string => Boolean(field));
  return { required, missing };
}
