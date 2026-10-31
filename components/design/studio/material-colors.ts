/** Shared color names and groups used by shop stock and studio finish pickers. */
export const MATERIAL_COLOR_CATEGORIES = [
  { id: "primary", label: "Primary colors", description: "Red, blue and yellow shades." },
  { id: "secondary", label: "Secondary colors", description: "Green, purple and orange shades." },
  { id: "pastel", label: "Pastel colors", description: "Soft, pale shades." },
  { id: "neutral", label: "Neutral colors", description: "White, black, grey and cream shades." },
  { id: "natural", label: "Earth & natural tones", description: "Natural material colors, browns and tans." },
  { id: "metallic", label: "Metallic finishes", description: "Supplied metal colors and finishes." },
  { id: "clear", label: "Clear & glass finishes", description: "Transparent, tinted and patterned finishes." },
] as const;
export type MaterialColorCategory = (typeof MATERIAL_COLOR_CATEGORIES)[number]["id"];

/** Stable catalog choices: availability is confirmed separately by each shop. */
export const MATERIAL_COLORS: ReadonlyArray<{ id: string; name: string; hex: string; category: MaterialColorCategory }> = [
  { id: "red", name: "Red", hex: "#c62828", category: "primary" },
  { id: "blue", name: "Blue", hex: "#1565c0", category: "primary" },
  { id: "yellow", name: "Yellow", hex: "#f9c62b", category: "primary" },
  { id: "green", name: "Green", hex: "#2e7d32", category: "secondary" },
  { id: "orange", name: "Orange", hex: "#ef6c00", category: "secondary" },
  { id: "purple", name: "Purple", hex: "#7b3fa0", category: "secondary" },
  { id: "pastel-pink", name: "Pastel pink", hex: "#edb6c6", category: "pastel" },
  { id: "pastel-blue", name: "Pastel blue", hex: "#b7d8f4", category: "pastel" },
  { id: "mint", name: "Mint", hex: "#bfe2cb", category: "pastel" },
  { id: "white", name: "White", hex: "#f5f5f0", category: "neutral" },
  { id: "black", name: "Black", hex: "#222222", category: "neutral" },
  { id: "grey", name: "Grey", hex: "#808080", category: "neutral" },
  { id: "cream", name: "Cream", hex: "#e9dfc9", category: "neutral" },
  { id: "brown", name: "Brown", hex: "#795548", category: "natural" },
  { id: "tan", name: "Tan", hex: "#c8a878", category: "natural" },
];
