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
  {
    // Services reach the database through `deps.client`, so tests inject a
    // fake. Only the files below build that default: each falls back to the
    // admin client when no client is injected. Types stay importable anywhere.
    files: ["src/services/**/*.{ts,tsx}"],
    ignores: [
      "src/services/**/*.test.{ts,tsx}",
      "src/services/**/*.test-support.{ts,tsx}",
      "src/services/audit-service.ts",
      "src/services/document-activity-service.ts",
      "src/services/document-comment-service.ts",
      "src/services/document-signing/persistence.ts",
      "src/services/documents/guest-service.ts",
      "src/services/documents/purge-service.ts",
      "src/services/documents/shared.ts",
      "src/services/documents/sharing-notice.ts",
      "src/services/generated-document-finalization-service.ts",
      "src/services/notifications/delivery-service.ts",
      "src/services/notifications/settings-service.ts",
      "src/services/organizations/editor-layout-service.ts",
      "src/services/organizations/invitation-service.ts",
      "src/services/organizations/lifecycle-service.ts",
      "src/services/organizations/membership-service.ts",
      "src/services/organizations/navigation-service.ts",
      "src/services/organizations/onboarding-service.ts",
      "src/services/organizations/role-service.ts",
      "src/services/organizations/saved-view-service.ts",
      "src/services/password-reset-service.ts",
      "src/services/public-forms/shared.ts",
      "src/services/send-to-answer-service.ts",
      "src/services/signup-service.ts",
      "src/services/submissions/shared.ts",
      "src/services/tasks/shared.ts",
      "src/services/template-flow/persistence.ts",
      "src/services/template-image-service.ts",
      "src/services/templates/shared.ts",
      "src/services/working-copies/notes-service.ts",
      "src/services/working-copies/working-copy-service.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/admin",
              message: "Take the client from deps.client; only files that build default deps may import createAdminClient.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
