"use client";

import { ThemeSwitcher } from "@/components/dashboard/theme-switcher";
import { useLanguage } from "@/components/language/language-context";
import { DeleteAccountSection } from "@/components/settings/delete-account-section";
import { ToggleSwitch } from "@/components/ui/toggle-switch";

export type SettingsSectionProps = {
  currentUserId: string | null;
  emailNotifyOrderReady: boolean;
  handleToggleEmailNotifyOrderReady: (next: boolean) => Promise<void>;
};

/**
 * Settings: appearance, email preferences and account deletion.
 *
 * Moved out of furnicraft-dashboard.tsx unchanged. The dashboard still owns
 * the state and the handlers; this receives exactly the values it reads.
 */
export default function SettingsSection({
  currentUserId,
  emailNotifyOrderReady,
  handleToggleEmailNotifyOrderReady,
}: SettingsSectionProps) {
  const { t } = useLanguage();
  return (
    // Each row wraps: below about 12rem of text the control moves under
    // it rather than squeezing it to a few words a line.
    <section className="settings-panel">
      <div className="card">
        {/* No intro line here: the section heading above already says what
            this page is for, and repeating it was one more thing to read. */}
        <div className="rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-[12rem] flex-1">
              <h4 className="font-semibold text-[var(--fc-text)]">{t("Appearance")}</h4>
              <p className="muted-small">{t("Choose the theme for your dashboard.")}</p>
            </div>
            <ThemeSwitcher />
          </div>
        </div>
        <div className="mt-3 rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-[12rem] flex-1">
              <h4 className="font-semibold text-[var(--fc-text)]">{t("Order ready emails")}</h4>
              <p className="muted-small">
                {t("Get an email when a shop marks your furniture ready for pick up, in addition to the notification here in FurniCraft.")}
              </p>
            </div>
            <ToggleSwitch
              checked={emailNotifyOrderReady}
              onChange={(next) => void handleToggleEmailNotifyOrderReady(next)}
              label={t("Email me when my order is ready for pick up")}
            />
          </div>
        </div>
        {currentUserId ? <DeleteAccountSection userId={currentUserId} /> : null}
      </div>
    </section>
  );
}
