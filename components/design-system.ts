/**
 * The design-system surface: the pieces of FurniCraft that are reusable UI
 * rather than application screens.
 *
 * This exists because the repo is an app, not a published component library --
 * there is no `dist/` and no package entry, so nothing otherwise says which
 * components are the design system and which are wired to Supabase, routing and
 * live data. Everything re-exported here renders standalone from props alone.
 *
 * It is the entry `design-sync` bundles for claude.ai/design, so a component
 * added here becomes available to the design agent, and one removed disappears
 * from it. Screens under components/dashboard, components/orders, components/shops
 * and components/design/studio are deliberately absent: they read the database
 * and the router, so they cannot render outside the app.
 */

// Primitives
export { Button, buttonVariants } from "@/components/ui/button";
export { Badge, badgeVariants } from "@/components/ui/badge";
export { Input } from "@/components/ui/input";
export { Label } from "@/components/ui/label";
export { Checkbox } from "@/components/ui/checkbox";
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from "@/components/ui/dropdown-menu";

// A phone field with the country picked rather than typed; stores "+63 917…".
export { default as PhoneInput, COUNTRIES, DEFAULT_COUNTRY, splitPhone, joinPhone } from "@/components/ui/phone-input";
export type { Country } from "@/components/ui/phone-input";

// Ratings
export { Stars, StarPicker, RatingLine, formatRating } from "@/components/reviews/stars";

// Brand marks for the platforms a shop links out to.
export { default as SocialIcon, brandLabel } from "@/components/shops/social-icons";

// Overlays
export { default as ImageLightbox } from "@/components/design/image-lightbox";

// Theme. ThemeProvider supplies the context ThemeSwitcher reads; the palette
// itself is CSS custom properties, so most components need no provider.
export { ThemeProvider } from "@/components/theme/theme-provider";
export { useTheme } from "@/components/theme/theme-context";
export { ThemeSwitcher } from "@/components/dashboard/theme-switcher";
