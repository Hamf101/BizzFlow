import { createHash, randomUUID } from "node:crypto"

import * as Y from "yjs"

import { isWellFormedWorkingCopy, savedContentOf } from "@/lib/collaboration/working-copy-checks"
import {
  createWorkingCopyDoc,
  holdsOnlyWorkingCopy,
  newWorkingCopyDoc,
  readWorkingCopyDoc,
  type WorkingCopy,
  writeWorkingCopyDoc,
} from "@/lib/collaboration/working-copy-doc"
import {
  createAdminClient,
  type AdminSupabaseClient,
  type WorkingCopyRoomRow,
  type WorkingCopyUpdateRow,
} from "@/lib/supabase/admin"
import { requireDocumentAccess } from "@/services/documents/access-service"
import { DocumentServiceError } from "@/services/documents/errors"
import { loadGeneratedDocumentView } from "@/services/document-signing/persistence"
import { DocumentSigningServiceError } from "@/services/document-signing/errors"
import { runOperation } from "@/services/operation"
import { POSTGREST_BATCH_SIZE, readAllInBatches } from "@/services/postgrest-paging"
import { requireStoredImages, TemplateImageServiceError, withTemplateImageUrls } from "@/services/template-image-service"
import { TemplateServiceError } from "@/services/templates/errors"
import { publishDocumentTemplate } from "@/services/templates/template-lifecycle-service"
import {
  assertTemplateImagesRenderable,
  getTemplateById,
  normalizeCategory,
  normalizeDescription,
  normalizeTitle,
  requirePermission,
} from "@/services/templates/shared"
import { type DocumentTemplate, type TemplateContent, upgradeV2TemplateContentToV3 } from "@/types/template"
import { mapImageAssets, withoutImageUrls } from "@/types/template-images"
import { withGeneratedFieldKeys } from "@/types/template-structure"

/**
 * Word to a room that a change was kept: its revision and who made it. The
 * change itself is fetched from the app, which checks each editor's access
 * every time, so someone who loses it stops receiving the work at once.
 */
export type WorkingCopyMessage = Readonly<{ by: string; revision: number }>

/** Word to a room that its checkpoints, comments or chat changed, so editors fetch them again. */
export type WorkingCopyNotesMessage = Readonly<{ by: string; notes: "chat" | "checkpoints" | "comments" }>

export type WorkingCopyServiceClient = Pick<AdminSupabaseClient, "from" | "rpc">

export type WorkingCopyServiceDeps = {
  /** Passes word of a kept change, or of new notes, to everyone in the room. */
  broadcast?: (topic: string, event: "notes" | "update", message: WorkingCopyMessage | WorkingCopyNotesMessage) => Promise<void>
  client?: WorkingCopyServiceClient
  createId?: () => string
  /** Reads a draft document as saved, once the member may still edit it. */
  loadDocument?: (client: WorkingCopyServiceClient, input: DocumentRoomInput) => Promise<WorkingCopy>
  publishTemplate?: typeof publishDocumentTemplate
  requireStoredImages?: typeof requireStoredImages
  signPictures?: typeof withTemplateImageUrls
}

/** Who is asking, and about which template's working copy. */
export type TemplateRoomInput = Readonly<{ actorUserId: string; organizationId: string; templateId: string }>

/** Who is asking, and about which draft document. */
export type DocumentRoomInput = Readonly<{ actorUserId: string; documentId: string; organizationId: string }>

/** A room's member, and the template or draft document it holds. */
export type RoomInput = DocumentRoomInput | TemplateRoomInput

/** A room as an editor joins it: everything kept so far, as one state. */
export type OpenedWorkingCopyRoom = Readonly<{ revision: number; roomId: string; state: Uint8Array; topic: string }>

/** A refusal fit to show, with the status it means. */
export class WorkingCopyServiceError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "WorkingCopyServiceError"
    this.statusCode = statusCode
  }
}

// The working copy as its template or document keeps it.
type Saved = Readonly<{
  category?: string | null
  content: TemplateContent
  description?: string | null
  title: string
}>

// What a room holds, and how to read and save it.
type Subject = Readonly<{
  column: "document_id" | "template_id"
  id: string
  load: () => Promise<WorkingCopy>
  saved: (copy: WorkingCopy) => Saved | null
}>

const ROOM_COLUMNS = "id,org_id,template_id,document_id,revision,state,state_revision,saved_hash"
const MAX_UPDATE_BYTES = 1_048_576
// Past this many kept updates, a room folds them into its state.
const COMPACT_AFTER = 100
// Tries before giving up when others keep landing their changes first.
const ATTEMPTS = 5
const SERVER = "server"

/**
 * Opens the room where a template's working copy is edited together, making
 * it on first use from the template as saved. A change made to the template
 * outside the room, as by an editor that was open before rooms, comes in as
 * the room's next update.
 *
 * @param input - The member and the template.
 * @param deps - Injected database, ids and broadcast for tests.
 * @returns The room, and everything kept in it so far.
 * @throws WorkingCopyServiceError 403 without templates:manage, 404 for a
 *   template not in the organization, 409 for an archived one.
 */
export async function openWorkingCopyRoom(
  input: RoomInput,
  deps: WorkingCopyServiceDeps = {}
): Promise<OpenedWorkingCopyRoom> {
  return runWorkingCopyOperation("open_working_copy_room", input, async () => {
    const client = deps.client ?? createAdminClient()
    const subject = subjectOf(client, input, deps)

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const saved = await subject.load()
      const savedHash = hashOf(subject.saved(saved) ?? saved)
      const room =
        (await findRoom(client, input, subject)) ??
        (await createRoom(client, input, subject, saved, savedHash, deps.createId ?? randomUUID))
      const loaded = await loadRoomDoc(client, room)

      if (!loaded) {
        continue
      }

      const change = room.saved_hash === savedHash ? null : captureChange(loaded, () => writeWorkingCopyDoc(loaded, saved, { origin: SERVER }))

      if (!change) {
        return { revision: room.revision, roomId: room.id, state: Y.encodeStateAsUpdate(loaded), topic: topicOf(room.id) }
      }

      const revision = await appendUpdate(client, room, change, input.actorUserId, null, savedHash)

      if (revision !== null) {
        await broadcastChange(deps, room.id, "update", { by: input.actorUserId, revision })
        return { revision, roomId: room.id, state: Y.encodeStateAsUpdate(loaded), topic: topicOf(room.id) }
      }
    }

    throw busy()
  })
}

/**
 * Keeps one editor's change to a template's working copy. The member must
 * still be allowed to edit templates; the change is applied to everything the
 * room has kept, and what the working copy becomes must be something saving
 * accepts apart from words still being typed. Only then is it kept as the
 * next revision, the template saved with it once complete, and the change
 * passed on to everyone else in the room. Sending the same change twice keeps
 * it once.
 *
 * @param input - The member, the template, its room, and the Yjs update.
 * @param deps - Injected database, images and broadcast for tests.
 * @returns The revision the room is at with the change.
 * @throws WorkingCopyServiceError 400 for bytes that are not an update, 403
 *   without templates:manage, 404 for another room, 409 for a change built on
 *   changes the room never kept, 413 when too large, 422 for a change that
 *   would break the working copy.
 */
export async function applyWorkingCopyUpdate(
  input: RoomInput & Readonly<{ roomId: string; update: Uint8Array }>,
  deps: WorkingCopyServiceDeps = {}
): Promise<{ revision: number }> {
  return runWorkingCopyOperation("apply_working_copy_update", input, async () => {
    if (input.update.byteLength > MAX_UPDATE_BYTES) {
      throw new WorkingCopyServiceError("This change is too large to keep. Try a smaller one.", 413)
    }

    const client = deps.client ?? createAdminClient()
    const subject = subjectOf(client, input, deps)

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      await subject.load()
      const room = await requireRoom(client, input, subject)
      const doc = await loadRoomDoc(client, room)

      if (!doc) {
        continue
      }

      const before = readWorkingCopyDoc(doc)
      const change = captureChange(doc, () => applyEditorUpdate(doc, input.update))

      if (!change) {
        return { revision: room.revision }
      }

      const after = readWorkingCopy(doc)
      const saved = subject.saved(after)

      if (saved) {
        const previous = savedContentOf(before.content)
        await (deps.requireStoredImages ?? requireStoredImages)(saved.content, previous, input.organizationId)
      }

      const savedHash = saved ? hashOf(saved) : null
      const saves = saved !== null && savedHash !== room.saved_hash
      const revision = await appendUpdate(client, room, change, input.actorUserId, saves ? saved : null, saves ? savedHash : null)

      if (revision === null) {
        continue
      }

      await broadcastChange(deps, room.id, "update", { by: input.actorUserId, revision })

      if (revision - room.state_revision >= COMPACT_AFTER) {
        await compactRoom(client, room, Y.encodeStateAsUpdate(doc), revision)
      }

      return { revision }
    }

    throw busy()
  })
}

/**
 * Catches an editor up with a room: the updates kept after the revision it
 * has, or, when those were folded into the room's state, that state and what
 * came after it.
 *
 * @param input - The member, the template, its room, and the revision the editor has.
 * @param deps - Injected database for tests.
 * @returns Updates to apply in order, and the revision they bring it to.
 */
export async function readWorkingCopySince(
  input: RoomInput & Readonly<{ afterRevision: number; roomId: string }>,
  deps: WorkingCopyServiceDeps = {}
): Promise<{ revision: number; updates: Uint8Array[] }> {
  return runWorkingCopyOperation("read_working_copy_since", input, async () => {
    const client = deps.client ?? createAdminClient()
    const subject = subjectOf(client, input, deps)

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      await subject.load()
      const room = await requireRoom(client, input, subject)
      const from = Math.max(input.afterRevision, room.state_revision)
      const kept = await readUpdatesAfter(client, room, from)

      if (!kept) {
        continue
      }

      const updates = kept.map((row) => fromBytea(row.update))
      return {
        revision: kept.at(-1)?.revision ?? from,
        updates: input.afterRevision < room.state_revision ? [fromBytea(room.state), ...updates] : updates,
      }
    }

    throw busy()
  })
}

/**
 * Publishes a template's working copy from its room, exactly as the person
 * publishing last saw it: refused when anyone's change was kept since, so
 * nobody publishes work they have not seen.
 *
 * @param input - The member, the template, its room, and the revision they last saw.
 * @param deps - Injected database and publish for tests.
 * @returns The published template.
 * @throws WorkingCopyServiceError 409 when the room has moved on, 400 while the
 *   working copy is unfinished, 503 while it is still being saved.
 */
export async function publishTemplateRoom(
  input: TemplateRoomInput & Readonly<{ roomId: string; roomRevision: number }>,
  deps: WorkingCopyServiceDeps = {}
): Promise<DocumentTemplate> {
  return runWorkingCopyOperation("publish_template_room", input, async () => {
    const client = deps.client ?? createAdminClient()
    const template = await requireEditableTemplate(client, input)
    const room = await requireRoom(client, input, subjectOf(client, input, deps))

    if (room.revision !== input.roomRevision) {
      throw new WorkingCopyServiceError("Someone changed this just now. Look it over, then publish again.", 409)
    }

    const doc = await loadRoomDoc(client, room)
    const saved = doc ? savedTemplateOf(readWorkingCopy(doc)) : null

    if (!saved) {
      throw new WorkingCopyServiceError("Finish the template's checks before you publish it.", 400)
    }

    const kept = workingCopyOf(template)

    // The template itself must hold what the room shows, or publishing would send something else.
    if (hashOf(savedTemplateOf(kept) ?? kept) !== hashOf(saved)) {
      throw busy()
    }

    return (deps.publishTemplate ?? publishDocumentTemplate)(
      { actorUserId: input.actorUserId, expectedRevision: template.revision, organizationId: input.organizationId, templateId: input.templateId },
      { client }
    )
  })
}

/**
 * Addresses this editor can load pictures from, for pictures in the room's
 * working copy it has none for yet, such as one someone else just added.
 * Only pictures the working copy holds are signed.
 *
 * @param input - The member, the template, its room, and the pictures' ids.
 * @param deps - Injected database and signing for tests.
 * @returns Each picture's address, by id.
 */
export async function signWorkingCopyPictures(
  input: RoomInput & Readonly<{ assetIds: readonly string[]; roomId: string }>,
  deps: WorkingCopyServiceDeps = {}
): Promise<Record<string, string>> {
  return runWorkingCopyOperation("sign_working_copy_pictures", input, async () => {
    const client = deps.client ?? createAdminClient()
    const subject = subjectOf(client, input, deps)
    await subject.load()
    const doc = await loadRoomDoc(client, await requireRoom(client, input, subject))

    if (!doc) {
      throw busy()
    }

    const wanted = new Set(input.assetIds.slice(0, 200))
    const signed = await (deps.signPictures ?? withTemplateImageUrls)(readWorkingCopy(doc).content, input.organizationId)
    const urls: Record<string, string> = {}

    mapImageAssets(signed, (asset) => {
      if (wanted.has(asset.id) && asset.url) {
        urls[asset.id] = asset.url
      }

      return asset
    })

    return urls
  })
}

async function requireEditableTemplate(client: WorkingCopyServiceClient, input: TemplateRoomInput): Promise<DocumentTemplate> {
  await requirePermission(client, input.organizationId, input.actorUserId, "templates:manage", "You cannot edit templates.")
  const template = await getTemplateById(client, input.organizationId, input.templateId)

  if (template.status === "archived") {
    throw new WorkingCopyServiceError("Archived templates cannot be edited.", 409)
  }

  return template
}

export function subjectOf(client: WorkingCopyServiceClient, input: RoomInput, deps: WorkingCopyServiceDeps): Subject {
  if ("templateId" in input) {
    return {
      column: "template_id",
      id: input.templateId,
      load: async () => workingCopyOf(await requireEditableTemplate(client, input)),
      saved: savedTemplateOf,
    }
  }

  return {
    column: "document_id",
    id: input.documentId,
    load: () => (deps.loadDocument ?? loadEditableDocument)(client, input),
    saved: savedDocumentOf,
  }
}

// A draft document as saved, once the member may still write in it: a
// contributor who can fill documents, before anyone was asked to sign.
async function loadEditableDocument(client: WorkingCopyServiceClient, input: DocumentRoomInput): Promise<WorkingCopy> {
  await requireDocumentAccess(
    {
      actorUserId: input.actorUserId,
      documentId: input.documentId,
      operation: "mutation",
      organizationId: input.organizationId,
      requiredAccess: "contributor",
      requiredOrganizationPermissionAction: "documents:fill",
    },
    client
  )
  const view = await loadGeneratedDocumentView(client, input.organizationId, input.documentId)

  if (view.document.lifecycleState !== "active") {
    throw new WorkingCopyServiceError("Archived documents cannot be changed.", 409)
  }

  if (view.workflowStatus !== "draft" || view.recipients.length > 0) {
    throw new WorkingCopyServiceError("This document was sent for signing, so its content can no longer change.", 409)
  }

  return { content: upgradeV2TemplateContentToV3(view.document.templateSnapshot), title: view.document.title }
}

async function findRoom(client: WorkingCopyServiceClient, input: RoomInput, subject: Subject): Promise<WorkingCopyRoomRow | null> {
  const { data, error } = await client
    .from("working_copy_rooms")
    .select(ROOM_COLUMNS)
    .eq(subject.column, subject.id)
    .eq("org_id", input.organizationId)
    .maybeSingle()

  if (error) {
    throw new WorkingCopyServiceError("Unable to open this working copy.", 500)
  }

  return data as WorkingCopyRoomRow | null
}

export async function requireRoom(
  client: WorkingCopyServiceClient,
  input: RoomInput & Readonly<{ roomId: string }>,
  subject: Subject
): Promise<WorkingCopyRoomRow> {
  const room = await findRoom(client, input, subject)

  if (!room || room.id !== input.roomId) {
    throw new WorkingCopyServiceError("This working copy is not open here. Reload to keep editing.", 404)
  }

  return room
}

async function createRoom(
  client: WorkingCopyServiceClient,
  input: RoomInput,
  subject: Subject,
  saved: WorkingCopy,
  savedHash: string,
  createId: () => string
): Promise<WorkingCopyRoomRow> {
  // Two people opening it at once make one room: the second insert gives way.
  const { error } = await client.from("working_copy_rooms").upsert(
    {
      ...(subject.column === "template_id" ? { template_id: subject.id } : { document_id: subject.id }),
      id: createId(),
      org_id: input.organizationId,
      saved_hash: savedHash,
      state: toBytea(Y.encodeStateAsUpdate(createWorkingCopyDoc(saved))),
    },
    { ignoreDuplicates: true, onConflict: subject.column }
  )
  const room = error ? null : await findRoom(client, input, subject)

  if (!room) {
    throw new WorkingCopyServiceError("Unable to open this working copy.", 500)
  }

  return room
}

// Everything a room has kept, as one document; null when the room folded its
// history while it was being read, so the read starts again.
export async function loadRoomDoc(client: WorkingCopyServiceClient, room: WorkingCopyRoomRow): Promise<Y.Doc | null> {
  const kept = await readUpdatesAfter(client, room, room.state_revision)

  if (!kept) {
    return null
  }

  const doc = newWorkingCopyDoc()
  Y.applyUpdate(doc, fromBytea(room.state), SERVER)

  for (const row of kept) {
    Y.applyUpdate(doc, fromBytea(row.update), SERVER)
  }

  return doc
}

// Updates after a revision, through at least the room's, or null when any is
// missing: they were folded into the state after the room was read.
async function readUpdatesAfter(
  client: WorkingCopyServiceClient,
  room: WorkingCopyRoomRow,
  after: number
): Promise<WorkingCopyUpdateRow[] | null> {
  const rows = await readAllInBatches<WorkingCopyUpdateRow>(
    async (previous) =>
      client
        .from("working_copy_updates")
        .select("revision,update")
        .eq("room_id", room.id)
        .eq("org_id", room.org_id)
        .gt("revision", previous?.revision ?? after)
        .order("revision", { ascending: true })
        .limit(POSTGREST_BATCH_SIZE) as unknown as Promise<{ data: WorkingCopyUpdateRow[] | null; error: unknown }>,
    {
      fail: () => new WorkingCopyServiceError("Unable to open this working copy.", 500),
      maxRows: 50_000,
      tooMany: () => new WorkingCopyServiceError("This working copy has too long a history to open.", 500),
    }
  )

  const complete =
    rows.every((row, index) => row.revision === after + index + 1) && (rows.at(-1)?.revision ?? after) >= room.revision

  return complete ? rows : null
}

function applyEditorUpdate(doc: Y.Doc, update: Uint8Array): void {
  try {
    Y.applyUpdate(doc, update, "editor")
  } catch {
    throw new WorkingCopyServiceError("This change could not be read.", 400)
  }

  if (doc.store.pendingStructs !== null || doc.store.pendingDs !== null) {
    throw new WorkingCopyServiceError("This editor missed some changes. Reload to keep editing.", 409)
  }

  if (!holdsOnlyWorkingCopy(doc)) {
    throw new WorkingCopyServiceError("This change could not be kept.", 422)
  }
}

export function readWorkingCopy(doc: Y.Doc): WorkingCopy {
  let value: WorkingCopy | null = null

  try {
    value = readWorkingCopyDoc(doc)
  } catch {
    // Shaped wrong, which the check below refuses.
  }

  if (!value || !isWellFormedWorkingCopy(value)) {
    throw new WorkingCopyServiceError("This change could not be kept.", 422)
  }

  return value
}

// What changed in a document while `apply` ran, as one update; null for nothing.
function captureChange(doc: Y.Doc, apply: () => void): Uint8Array | null {
  const changes: Uint8Array[] = []
  const collect = (update: Uint8Array): void => {
    changes.push(update)
  }

  doc.on("update", collect)

  try {
    apply()
  } finally {
    doc.off("update", collect)
  }

  return changes.length > 0 ? Y.mergeUpdates(changes) : null
}

async function appendUpdate(
  client: WorkingCopyServiceClient,
  room: WorkingCopyRoomRow,
  update: Uint8Array,
  actorUserId: string,
  saved: Saved | null,
  savedHash: string | null
): Promise<number | null> {
  const { data, error } = await client.rpc("append_working_copy_update", {
    expected_revision: room.revision,
    saved_hash: savedHash,
    saved_working_copy: saved,
    target_actor_user_id: actorUserId,
    target_org_id: room.org_id,
    target_room_id: room.id,
    target_update: toBytea(update),
  })

  if (error) {
    throw error.code === "23514"
      ? new WorkingCopyServiceError("This template can no longer be edited.", 409)
      : new WorkingCopyServiceError("Unable to keep this change.", 500)
  }

  return typeof data === "number" ? data : null
}

async function compactRoom(client: WorkingCopyServiceClient, room: WorkingCopyRoomRow, state: Uint8Array, revision: number): Promise<void> {
  const { error } = await client.rpc("compact_working_copy_room", {
    target_org_id: room.org_id,
    target_room_id: room.id,
    target_state: toBytea(state),
    target_state_revision: revision,
  })

  // The change is kept either way; the next one tries again.
  if (error) {
    console.warn("working_copy_compaction_failed", { revision, roomId: room.id })
  }
}

/**
 * Passes word to everyone in a room. Whatever it is about is already kept, so
 * an editor that misses it catches up from the room.
 */
export async function broadcastChange(
  deps: WorkingCopyServiceDeps,
  roomId: string,
  event: "notes" | "update",
  message: WorkingCopyMessage | WorkingCopyNotesMessage
): Promise<void> {
  try {
    await (deps.broadcast ?? broadcastWithRealtime)(topicOf(roomId), event, message)
  } catch (error: unknown) {
    console.warn("working_copy_broadcast_failed", {
      event,
      reason: error instanceof Error ? error.message : "Unknown broadcast error",
      roomId,
    })
  }
}

async function broadcastWithRealtime(topic: string, event: string, message: object): Promise<void> {
  const client = createAdminClient()
  const channel = client.channel(topic, { config: { private: true } })

  try {
    const result = await channel.httpSend(event, message)

    if (!result.success) {
      throw new Error(result.error)
    }
  } finally {
    await client.removeChannel(channel)
  }
}

// The template as the editor has always opened it.
function workingCopyOf(template: DocumentTemplate): WorkingCopy {
  return {
    category: template.category ?? "",
    content: withGeneratedFieldKeys(upgradeV2TemplateContentToV3(template.content)),
    description: template.description ?? "",
    title: template.title,
  }
}

// The working copy as saving writes it to the template, or null while unfinished.
function savedTemplateOf(copy: WorkingCopy): Saved | null {
  const content = savedContentOf(copy.content)

  if (!content) {
    return null
  }

  try {
    const stored = withoutImageUrls(content)
    assertTemplateImagesRenderable(stored)

    return {
      category: normalizeCategory(copy.category || null),
      content: stored,
      description: normalizeDescription(copy.description || null),
      title: normalizeTitle(copy.title),
    }
  } catch {
    return null
  }
}

// A draft document's title and pages as saving writes them, or null while unfinished.
function savedDocumentOf(copy: WorkingCopy): Saved | null {
  const title = copy.title.trim()
  const content = savedContentOf(copy.content)

  return content && title.length > 0 && title.length <= 180 ? { content: withoutImageUrls(content), title } : null
}

// Key order aside, the same working copy always hashes the same, however the database stored it.
export function hashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical)
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)])
    )
  }

  return value
}

function topicOf(roomId: string): string {
  return `working-copy:${roomId}`
}

function toBytea(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString("hex")}`
}

function fromBytea(value: string): Uint8Array {
  if (!value.startsWith("\\x")) {
    throw new WorkingCopyServiceError("Unable to open this working copy.", 500)
  }

  return new Uint8Array(Buffer.from(value.slice(2), "hex"))
}

// Worth trying again, unlike a refusal: an editor keeps its change and resends it.
export function busy(): WorkingCopyServiceError {
  return new WorkingCopyServiceError("Many changes are arriving at once. Try again in a moment.", 503)
}

export function runWorkingCopyOperation<T>(
  operationName: string,
  input: RoomInput & Readonly<{ roomId?: string }>,
  operation: () => Promise<T>
): Promise<T> {
  return runOperation(
    "working_copy",
    (error: unknown) => {
      if (error instanceof WorkingCopyServiceError) {
        return error
      }

      if (
        error instanceof TemplateServiceError ||
        error instanceof TemplateImageServiceError ||
        error instanceof DocumentServiceError ||
        error instanceof DocumentSigningServiceError
      ) {
        return new WorkingCopyServiceError(error.message, error.statusCode)
      }

      return new WorkingCopyServiceError("Unable to keep this change.", 500)
    },
    operationName,
    {
      actorUserId: input.actorUserId,
      documentId: "documentId" in input ? input.documentId : undefined,
      organizationId: input.organizationId,
      roomId: input.roomId,
      templateId: "templateId" in input ? input.templateId : undefined,
    },
    operation
  )
}
