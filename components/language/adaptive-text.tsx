"use client";

/** Display submitted prose as written, without translation or network requests.
 * Retains existing layout options for descriptions, evidence and chat bubbles.
 */
export function AdaptiveText({ text, translationOnly = false, plain = false, textClassName }: {
  text: string;
  automatic?: boolean;
  translationOnly?: boolean;
  plain?: boolean;
  textClassName?: string;
}) {
  if (translationOnly) return null;
  return <span className={plain ? undefined : "whitespace-pre-wrap [overflow-wrap:anywhere]"}>
    <span className={textClassName}>{text}</span>
  </span>;
}
