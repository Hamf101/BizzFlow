import { PostgrestReadQuery, type FakeRow } from "@/services/postgrest-fake.test-support"
import { answerTemplateAccess } from "@/services/templates/access.test-support"
import { templateContentV3Schema } from "@/types/template"

export const ORG_ID = "10000000-0000-4000-8000-000000000001"
export const OTHER_ORG_ID = "10000000-0000-4000-8000-000000000002"
export const MANAGER_ID = "20000000-0000-4000-8000-000000000001"
export const OWNER_ID = "20000000-0000-4000-8000-000000000002"
export const STAFF_ID = "20000000-0000-4000-8000-000000000003"
export const TEMPLATE_ID = "30000000-0000-4000-8000-000000000001"
export const ROOM_ID = "40000000-0000-4000-8000-000000000001"
export const INTRO = "50000000-0000-4000-8000-000000000001"
export const NAME = "50000000-0000-4000-8000-000000000002"

/** Who is asking about the template, in which organization. */
export const as = (actorUserId: string, organizationId = ORG_ID) => ({ actorUserId, organizationId, templateId: TEMPLATE_ID })

export type Tables = Record<
  | "document_templates"
  | "organization_memberships"
  | "profiles"
  | "working_copy_checkpoints"
  | "working_copy_comments"
  | "working_copy_messages"
  | "working_copy_rooms"
  | "working_copy_updates",
  FakeRow[]
>

export function database(): Tables {
  return {
    document_templates: [
      {
        archived_at: null,
        category: "Sales",
        content: templateContentV3Schema.parse({
          schemaVersion: 3,
          blocks: [
            { id: INTRO, type: "paragraph", text: "Welcome aboard." },
            { id: NAME, type: "text_field", fieldKey: "client_name", label: "Client name" },
          ],
          sections: [],
          fieldGroups: [],
          blockRules: [],
        }),
        created_at: "2026-09-28T09:00:00.000Z",
        description: null,
        id: TEMPLATE_ID,
        org_id: ORG_ID,
        published_at: null,
        published_revision: null,
        revision: 4,
        status: "draft",
        title: "Welcome pack",
        updated_at: "2026-09-28T09:00:00.000Z",
      },
    ],
    organization_memberships: [
      { org_id: ORG_ID, role: "manager", status: "active", user_id: MANAGER_ID },
      { org_id: ORG_ID, role: "owner_admin", status: "active", user_id: OWNER_ID },
      { org_id: ORG_ID, role: "staff", status: "active", user_id: STAFF_ID },
    ],
    profiles: [
      { email: "maya@example.com", full_name: "Maya Chen", id: MANAGER_ID },
      { email: "omar@example.com", full_name: "Omar Haddad", id: OWNER_ID },
    ],
    working_copy_checkpoints: [],
    working_copy_comments: [],
    working_copy_messages: [],
    working_copy_rooms: [],
    working_copy_updates: [],
  }
}

// One second apart, so what was written later sorts later.
let tick = 0
const nextTime = (): string => new Date(Date.UTC(2026, 8, 28, 12, 0, tick++)).toISOString()

/** What the database does, as far as the service can tell: reads, the room insert, and the two functions. */
export function fakeClient(tables: Tables, onAppend?: () => void, onRead?: (table: keyof Tables) => void) {
  return {
    from: (table: keyof Tables) => ({
      select: (columns?: string) => {
        onRead?.(table)
        // Copies, as a database answers: a later write never changes a row already read.
        return new PostgrestReadQuery(tables[table].map((row) => ({ ...row }))).select(columns)
      },
      insert: (row: FakeRow) => ({
        select: () => ({
          single: async () => {
            const stored = { created_at: nextTime(), ...row }
            tables[table].push(stored)
            return { data: { ...stored }, error: null }
          },
        }),
      }),
      update: (values: FakeRow) => {
        const filters: Array<[string, unknown]> = []
        const query = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value])
            return query
          },
          then: (resolve: (result: { data: null; error: null }) => unknown) => {
            for (const row of tables[table]) {
              if (filters.every(([column, value]) => row[column] === value)) Object.assign(row, values)
            }
            return Promise.resolve({ data: null, error: null }).then(resolve)
          },
        }
        return query
      },
      upsert: async (row: FakeRow, options: { ignoreDuplicates?: boolean; onConflict: string }) => {
        if (!tables[table].some((existing) => existing[options.onConflict] === row[options.onConflict])) {
          tables[table].push({ document_id: null, revision: 0, state_revision: 0, ...row })
        }
        return { data: null, error: null }
      },
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "get_template_access_level") {
        return answerTemplateAccess(tables as never, name, args)
      }

      const room = tables.working_copy_rooms.find((candidate) => candidate.id === args.target_room_id && candidate.org_id === args.target_org_id)

      if (name === "append_working_copy_update") {
        onAppend?.()
        if (!room || room.revision !== args.expected_revision) return { data: null, error: null }
        const template = tables.document_templates.find((candidate) => candidate.id === room.template_id)
        const saved = args.saved_working_copy as Record<string, unknown> | null

        if (saved && template?.status === "archived") {
          return { data: null, error: { code: "23514", message: "The working copy can no longer be edited." } }
        }

        room.revision = Number(room.revision) + 1
        tables.working_copy_updates.push({ actor_user_id: args.target_actor_user_id, org_id: room.org_id, revision: room.revision, room_id: room.id, update: args.target_update })
        if (saved && template) {
          Object.assign(template, { category: saved.category, content: saved.content, description: saved.description, revision: Number(template.revision) + 1, title: saved.title, updated_by: args.target_actor_user_id })
        }
        if (args.saved_hash) room.saved_hash = args.saved_hash
        return { data: room.revision, error: null }
      }

      if (name === "compact_working_copy_room") {
        if (!room || Number(room.state_revision) >= Number(args.target_state_revision) || Number(room.revision) < Number(args.target_state_revision)) {
          return { data: false, error: null }
        }
        Object.assign(room, { state: args.target_state, state_revision: args.target_state_revision })
        tables.working_copy_updates = tables.working_copy_updates.filter((update) => update.room_id !== room.id || Number(update.revision) > Number(args.target_state_revision))
        return { data: true, error: null }
      }

      throw new Error(`Unexpected function ${name}`)
    },
  }
}
