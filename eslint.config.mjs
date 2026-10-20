import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Every public table with an `org_id` column, read from the database that
// `supabase/migrations` builds (information_schema.columns). Services use the
// service-role client, which bypasses RLS, so their `org_id` filter IS the
// tenant barrier. Add a table here when a migration gives it `org_id`.
const TENANT_TABLES = new Set([
  "audit_logs", "document_access_grants", "document_activity_events", "document_answers",
  "document_comments", "document_guest_grants", "document_recent_accesses",
  "document_signing_recipients", "document_template_versions", "document_templates",
  "document_versions", "documents", "folder_access_grants", "folders",
  "generated_document_finalizations", "invites", "notification_deliveries",
  "organization_memberships", "organization_roles", "public_form_links", "resource_purge_jobs",
  "resource_purge_members", "resource_purge_objects", "resource_purge_receipts",
  "resource_purge_tombstones", "saved_list_views", "submission_activity_events",
  "submission_answer_suggestions", "submission_comments", "submission_files",
  "submission_reviewers", "submissions", "task_reminders", "tasks", "template_access_grants",
  "template_flow_messages", "working_copy_checkpoints", "working_copy_comments",
  "working_copy_messages", "working_copy_rooms", "working_copy_updates",
]);

const hasOrgIdKey = (node) =>
  node?.type === "TSAsExpression" || node?.type === "TSSatisfiesExpression"
    ? hasOrgIdKey(node.expression)
    : node?.type === "CallExpression" && node.callee.property?.name === "map"
    ? hasOrgIdKey(node.arguments[0]?.body)
    : node?.type === "ArrayExpression"
    ? node.elements.length > 0 && node.elements.every(hasOrgIdKey)
    : node?.type === "ObjectExpression" &&
      node.properties.some((p) => p.type === "Property" && (p.key.name ?? p.key.value) === "org_id");

// A `.from("<tenant table>")` chain must carry `.eq("org_id", …)`,
// `.match({ org_id })` or an insert/upsert literal with `org_id`, unless a
// `// tenant-scope: <reason>` comment sits right above it.
const tenantScopeRule = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const sourceCode = context.sourceCode;
    const escaped = (token) =>
      token && sourceCode.getCommentsBefore(token).some((c) => c.value.trim().startsWith("tenant-scope:"));
    return {
      "CallExpression[callee.property.name='from'][arguments.0.type='Literal']"(node) {
        if (!TENANT_TABLES.has(node.arguments[0].value)) return;
        let chain = node;
        let scoped = false;
        for (;;) {
          const [first] = chain.arguments;
          const method = chain.callee.property?.name;
          if (
            (method === "eq" && first?.value === "org_id") ||
            (method === "match" && hasOrgIdKey(first)) ||
            ((method === "insert" || method === "upsert") && hasOrgIdKey(first))
          ) scoped = true;
          const member = chain.parent;
          if (member?.type !== "MemberExpression" || member.parent?.type !== "CallExpression") break;
          chain = member.parent;
        }
        if (scoped) return;
        let statement = chain;
        while (statement.parent && !/(Statement|Declaration)$/.test(statement.type)) statement = statement.parent;
        const tokens = [sourceCode.getTokenBefore(node.callee.property), sourceCode.getFirstToken(chain), sourceCode.getFirstToken(statement)];
        if (tokens.some(escaped)) return;
        context.report({
          node,
          message: `Query on tenant table "${node.arguments[0].value}" has no org_id filter. Add .eq("org_id", …) or a "// tenant-scope: <reason>" comment above it.`,
        });
      },
    };
  },
};

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
    files: ["src/services/**/*.{ts,tsx}"],
    ignores: ["src/services/**/*.test.{ts,tsx}", "src/services/**/*.test-support.{ts,tsx}"],
    plugins: { bizflow: { rules: { "tenant-scope": tenantScopeRule } } },
    rules: { "bizflow/tenant-scope": "error" },
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
      "src/services/organizations/hierarchy-service.ts",
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
  // A promise nobody awaits fails silently: a write that never lands, an error
  // nobody sees. Server code only; it needs types, so it costs a cold lint more.
  {
    files: ["src/services/**/*.ts", "src/app/**/*.ts", "src/lib/**/*.ts", "src/inngest/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.test-support.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },
]);

export default eslintConfig;
