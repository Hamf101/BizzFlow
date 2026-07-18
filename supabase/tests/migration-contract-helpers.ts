import { join } from "node:path"

export type MigrationFileName =
  | "20260708170500_sprint_2_organizations_roles.sql"
  | "20260708174500_sprint_3_rls_permissions.sql"
  | "20260708190000_sprint_4_documents.sql"
  | "20260717190016_sprint_5_document_versioning_comments.sql"
  | "20260717193648_sprint_5_atomic_document_comments.sql"
  | "20260717194631_sprint_5_completion_archive_hardening.sql"
  | "20260717205037_document_templates_signing_recents.sql"
  | "20260718002902_audit_security_hardening.sql"

export const directWriteActions = ["insert", "update", "delete"] as const

/**
 * Resolves a known migration filename from the repository root.
 *
 * @param fileName - Compile-time-checked migration filename.
 * @returns Absolute path to the migration SQL file.
 */
export function getMigrationPath(fileName: MigrationFileName): string {
  return join(process.cwd(), "supabase/migrations", fileName)
}

/**
 * Extracts a table's column and constraint body from migration SQL.
 *
 * @param sql - Migration SQL source.
 * @param tableName - Unqualified public table name.
 * @returns The table definition body.
 * @throws Error when the requested table definition is absent.
 */
export function getTableDefinition(sql: string, tableName: string): string {
  const pattern = new RegExp(
    `create table public\\.${tableName} \\(([\\s\\S]*?)\\n\\);`
  )
  const match = sql.match(pattern)

  if (!match) {
    throw new Error(`Missing table definition for public.${tableName}.`)
  }

  return match[1]
}

/**
 * Normalizes SQL for whitespace-insensitive contract assertions.
 *
 * @param sql - Migration SQL source.
 * @returns Lowercase SQL with runs of whitespace collapsed.
 */
export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase()
}

/**
 * Finds authenticated write grants that target the supplied tables.
 *
 * @param sql - Migration SQL source.
 * @param tableNames - Public table names whose grants should be inspected.
 * @returns Normalized matching grant statements.
 */
export function getAuthenticatedWriteGrantStatements(
  sql: string,
  tableNames: readonly string[]
): readonly string[] {
  const targetedTables = tableNames.map(
    (tableName: string): string => `public.${tableName}`
  )

  return getSqlStatements(sql).filter((statement: string): boolean => {
    const grantMatch = statement.match(
      /^grant\s+(.+?)\s+on\s+table\s+(.+?)\s+to\s+(.+?)$/
    )

    if (!grantMatch) {
      return false
    }

    const privileges = grantMatch[1]
      .split(",")
      .map((privilege: string): string => privilege.trim())
    const tableTargets = grantMatch[2]
      .split(",")
      .map((tableTarget: string): string => tableTarget.trim())
    const grantees = grantMatch[3]
      .split(",")
      .map((grantee: string): string => grantee.trim())
    const grantsAuthenticated = grantees.some(
      (grantee: string): boolean => grantee === "authenticated"
    )
    const targetsDocumentTable = tableTargets.some(
      (tableTarget: string): boolean => targetedTables.includes(tableTarget)
    )
    const includesWritePrivilege = privileges.some(
      (privilege: string): boolean =>
        directWriteActions.includes(
          privilege as (typeof directWriteActions)[number]
        ) ||
        privilege === "all" ||
        privilege === "all privileges"
    )

    return grantsAuthenticated && targetsDocumentTable && includesWritePrivilege
  })
}

function getSqlStatements(sql: string): readonly string[] {
  return normalizeSql(sql)
    .split(";")
    .map((statement: string): string => statement.trim())
    .filter((statement: string): boolean => statement.length > 0)
}
