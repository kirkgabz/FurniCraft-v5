"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useRef, useState } from "react";

/** The public address of a template: opens in any browser, no account needed to look. */
export function sharedTemplateUrl(templateId: string): string {
  return `${window.location.origin}/t/${templateId}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API refused (an older browser, or a page not focused): the
    // old way still works almost everywhere.
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    field.remove();
    return copied;
  }
}

/**
 * Copies a template's shared link. Says what happened in the button itself,
 * and falls back to showing the link when the browser will not copy it, so
 * there is always a way to get it.
 */
export function CopyLinkButton({
  templateId,
  title,
  className = "btn btn-secondary btn-sm",
  compact = false,
}: {
  templateId: string;
  title: string;
  className?: string;
  /** Icon only, for a template card's action row. */
  compact?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const onClick = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const url = sharedTemplateUrl(templateId);
    const copied = await copyText(url);
    if (!copied) {
      window.prompt("Copy this link:", url);
      setState("failed");
    } else {
      setState("copied");
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  };

  const label = state === "copied" ? "Copied" : "Copy link";
  return (
    <button
      type="button"
      className={className}
      onClick={(event) => void onClick(event)}
      title={uiText("Copy a link anyone can open to see this piece in 3D")}
      aria-label={state === "copied" ? uiText("Link to {0} copied", { 0: title }) : uiText("Copy a link to {0}", { 0: title })}
    >
      <span className="inline-flex items-center gap-1.5">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {state === "copied" ? (
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          ) : (
            <>
              <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
              <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
            </>
          )}
        </svg>
        {/* Icon only on a card: its action row has room for three labels, not four. */}
        {compact ? null : <span>{uiText(label)}</span>}
      </span>
      <span role="status" className="sr-only">
        {state === "copied" ? uiText("Link copied") : ""}
      </span>
    </button>
  );
}
