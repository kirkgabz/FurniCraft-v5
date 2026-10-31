"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


export function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={uiText(label)}
      onClick={() => onChange(!checked)}
      className={`tap-target relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
        checked ? "bg-[var(--fc-ink-accent)]" : "bg-[var(--fc-border)]"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-fc ${
          checked ? "translate-x-[20px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}
