import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
      // Local throwaway scripts (gitignored); not part of the app.
      ".scratch/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // `const { triPositions: _dropped, ...reportFields } = shell` is how the
      // analysis scripts strip a multi-megabyte float array before serializing
      // everything else. The named-and-omitted binding IS the idiom, not a
      // forgotten variable, and listing the surviving fields by hand instead
      // would silently drop any field added later. Spelled out in full rather
      // than passing one key, so the other three stay at the values
      // typescript-eslint documents as its defaults rather than depending on
      // how partial options merge.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { vars: "all", args: "after-used", caughtErrors: "all", ignoreRestSiblings: true },
      ],
    },
  },
];

export default eslintConfig;
