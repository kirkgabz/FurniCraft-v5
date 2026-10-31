/**
 * The one look for every "back" control in the app: a squared, outlined
 * button with an arrow and the name of where it goes.
 *
 * There were five. The commission path's (this one), a white pill with a
 * shadow on the furniture picker, a 4px-cornered filled box on the sign-in
 * pages, a rounded-full chip on Generate template and a bare text link on the
 * shop dashboard. Side by side -- the picker shows the trail's Back directly
 * above "All furniture" -- they read as two different kinds of control.
 *
 * A plain module, not part of back-button.tsx: that file is "use client", and
 * the auth pages that use this are server components, which would receive a
 * client reference rather than the string.
 */
export const BACK_BUTTON_CLASS =
  "group inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--fc-border)] px-2.5 py-1.5 text-sm font-semibold text-[var(--fc-text)] transition-[background-color,border-color,transform] duration-150 ease-out hover:border-[var(--fc-accent-2)] hover:bg-[var(--fc-cane-soft)] active:scale-[0.97] [@media(pointer:coarse)]:min-h-11";
