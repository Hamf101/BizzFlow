import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    ".agent/**",
    ".claude/**",
    ".tmp/**",
    "artifacts/**",
    // Scratch output from the Supabase CLI — `supabase start` writes generated
    // edge-runtime sources here. Gitignored, but ESLint reads its own list.
    "supabase/.temp/**",
  ]),
  {
    // Playwright names a fixture's setup callback parameter `use`, which the
    // React plugin reads as the `use` hook being called outside a component.
    // The rule has nothing to enforce in a browser test, so it is switched off
    // here rather than worked around by renaming Playwright's own API.
    files: ["e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
]);

export default eslintConfig;
