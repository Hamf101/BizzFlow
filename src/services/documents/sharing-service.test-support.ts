/**
 * A small in-memory Supabase stand-in for the sharing service's tests: it
 * answers the filters and writes the service uses, and access questions the
 * service asks the database (rpc) from a table the test fills in.
 */
import type {
  SetSharingAccessInput,
  SetSharingInheritanceInput,
  SharingInput,
  SharingServiceDeps,
  SharingView,
} from "@/services/documents/sharing-contracts"
import {
  prepareSharingAccess,
  prepareSharingInheritance,
  type PreparedSharingChange,
} from "@/services/documents/sharing-service"
import { runDocumentOperation } from "@/services/documents/shared"
import {
  PostgrestWriteQuery,
  type FakeOperation,
  type FakeRow,
} from "@/services/postgrest-fake.test-support"

export type { FakeRow }

// A grant is unique per item and grantee, as the tables' unique indexes keep it.
const sameGrant = (left: FakeRow, right: FakeRow): boolean =>
  left.org_id === right.org_id &&
  (left.document_id ?? left.folder_id ?? left.template_id) === (right.document_id ?? right.folder_id ?? right.template_id) &&
  left.user_id === right.user_id &&
  left.organization_role === right.organization_role &&
  left.email === right.email

export class SharingFakeClient {
  readonly writes: string[] = []

  /**
   * @param tables - Rows by table name.
   * @param access - What the database would answer for "can this person open
   *   this?", keyed `<person>:<item>`; anything missing is no access.
   */
  constructor(
    readonly tables: Record<string, FakeRow[]>,
    private readonly access: Record<string, "contributor" | "editor" | "user" | "viewer"> = {}
  ) {}

  from(table: string): PostgrestWriteQuery {
    return new PostgrestWriteQuery(this.tables, table, {
      before: (tableName: string, operation: FakeOperation, rows: readonly FakeRow[]) => {
        const existing = this.tables[tableName] ?? []

        if (operation === "insert" && rows.some((row) => "access_level" in row && existing.some((other) => sameGrant(other, row)))) {
          return { code: "23505", message: "duplicate key" }
        }

        if (operation !== "select") this.writes.push(`${operation} ${tableName}`)
      },
    })
  }

  async rpc(_name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: null }> {
    const item = args.target_document_id ?? args.target_folder_id ?? args.target_template_id

    return { data: this.access[`${String(args.target_actor_user_id)}:${String(item)}`] ?? null, error: null }
  }
}

/**
 * Makes one item's sharing change at once. The app shares through the Many
 * variants; the tests drive the single-item checks through this.
 */
async function runSharingChange(
  name: string,
  input: SharingInput,
  prepare: () => Promise<PreparedSharingChange>
): Promise<SharingView> {
  return runDocumentOperation(name, { actorUserId: input.actorUserId, organizationId: input.organizationId }, async () => {
    const change = await prepare()

    await change.apply()

    return change.view()
  })
}

export const setSharingAccess = (input: SetSharingAccessInput, deps: SharingServiceDeps = {}): Promise<SharingView> =>
  runSharingChange("set_sharing_access", input, () => prepareSharingAccess(input, deps))

export const setSharingInheritance = (
  input: SetSharingInheritanceInput,
  deps: SharingServiceDeps = {}
): Promise<SharingView> =>
  runSharingChange("set_sharing_inheritance", input, () => prepareSharingInheritance(input, deps))
