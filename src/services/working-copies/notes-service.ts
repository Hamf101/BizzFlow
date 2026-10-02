import { randomUUID } from "node:crypto"

import type { WorkingCopy } from "@/lib/collaboration/working-copy-doc"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  indexDocumentCollaborationProfiles,
  listDocumentCollaborationProfiles,
  resolveDocumentCollaborationDisplayName,
  uniqueDocumentCollaborationProfileIds,
} from "@/services/document-collaboration/profiles"

import {
  broadcastChange,
  busy,
  hashOf,
  loadRoomDoc,
  readWorkingCopy,
  requireRoom,
  type RoomInput,
  runWorkingCopyOperation,
  subjectOf,
  type WorkingCopyServiceClient,
  type WorkingCopyServiceDeps,
  WorkingCopyServiceError,
} from "./working-copy-service"

/** A point in a working copy's life that people can come back to. */
export type WorkingCopyCheckpoint = Readonly<{
  createdAt: string
  createdBy: string
  id: string
  label: string
  /** Set on the copy a restore kept first: the checkpoint it brought back. */
  restoredFrom: string | null
  revision: number
}>

/** One comment: the first of a thread, on a block or the page, or a reply. */
export type WorkingCopyComment = Readonly<{
  author: string
  authorId: string | null
  blockId: string | null
  body: string
  createdAt: string
  id: string
  quote: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  threadId: string
}>

/** One message in the chat among everyone editing a working copy. */
export type WorkingCopyChatMessage = Readonly<{
  author: string
  authorId: string | null
  body: string
  createdAt: string
  id: string
}>

type RoomNoteInput = RoomInput & Readonly<{ roomId: string }>

type CheckpointRow = {
  created_at: string
  created_by: string | null
  id: string
  label: string
  restored_from: string | null
  revision: number
  value?: unknown
}

type CommentRow = {
  author_id: string | null
  block_id: string | null
  body: string
  created_at: string
  id: string
  quote: string | null
  resolved_at: string | null
  resolved_by: string | null
  thread_id: string
}

type MessageRow = { author_id: string | null; body: string; created_at: string; id: string }

const CHECKPOINT_COLUMNS = "id,label,revision,restored_from,created_by,created_at"
const COMMENT_COLUMNS = "id,thread_id,block_id,quote,body,author_id,created_at,resolved_at,resolved_by"
const MESSAGE_COLUMNS = "id,body,author_id,created_at"
// How far back each list reaches.
const MOST_CHECKPOINTS = 50
const MOST_COMMENTS = 500
const MOST_MESSAGES = 200

/**
 * Keeps the working copy as it stands now, under a name, to come back to.
 *
 * @param input - The member, what the room holds, the room, and the name.
 * @param deps - Injected database, ids and broadcast for tests.
 * @returns The checkpoint.
 */
export async function saveWorkingCopyCheckpoint(
  input: RoomNoteInput & Readonly<{ label: string }>,
  deps: WorkingCopyServiceDeps = {}
): Promise<WorkingCopyCheckpoint> {
  return runWorkingCopyOperation("save_working_copy_checkpoint", input, async () => {
    const client = deps.client ?? createAdminClient()
    const label = requireText(input.label, 120, "Give the checkpoint a name of up to 120 characters.")
    const { copy, revision } = await readRoom(client, input, deps)
    const checkpoint = await insertCheckpoint(client, input, deps, { copy, label, restoredFrom: null, revision })

    await broadcastChange(deps, input.roomId, "notes", { by: input.actorUserId, notes: "checkpoints" })
    return (await nameCheckpoints(client, [checkpoint]))[0]!
  })
}

/**
 * The working copy's checkpoints, newest first.
 *
 * @param input - The member, what the room holds, and the room.
 * @param deps - Injected database for tests.
 * @returns Up to the last fifty checkpoints.
 */
export async function listWorkingCopyCheckpoints(
  input: RoomNoteInput,
  deps: WorkingCopyServiceDeps = {}
): Promise<WorkingCopyCheckpoint[]> {
  return runWorkingCopyOperation("list_working_copy_checkpoints", input, async () => {
    const client = deps.client ?? createAdminClient()
    await requireNoteRoom(client, input, deps)
    const { data, error } = await client
      .from("working_copy_checkpoints")
      .select(CHECKPOINT_COLUMNS)
      .eq("room_id", input.roomId)
      .eq("org_id", input.organizationId)
      .order("created_at", { ascending: false })
      .limit(MOST_CHECKPOINTS)

    if (error || !data) {
      throw new WorkingCopyServiceError("Unable to load checkpoints.", 500)
    }

    return nameCheckpoints(client, data as CheckpointRow[])
  })
}

/**
 * Brings a checkpoint back. The copy it replaces is kept first, pointing at
 * the checkpoint, so going back can itself be undone; the checkpoint's copy
 * then comes back as an edit, kept and passed on like any other.
 *
 * @param input - The member, what the room holds, the room, and the checkpoint.
 * @param deps - Injected database, ids and broadcast for tests.
 * @returns The working copy the checkpoint kept.
 */
export async function restoreWorkingCopyCheckpoint(
  input: RoomNoteInput & Readonly<{ checkpointId: string }>,
  deps: WorkingCopyServiceDeps = {}
): Promise<WorkingCopy> {
  return runWorkingCopyOperation("restore_working_copy_checkpoint", input, async () => {
    const client = deps.client ?? createAdminClient()
    const { copy, revision } = await readRoom(client, input, deps)
    const { data, error } = await client
      .from("working_copy_checkpoints")
      .select(`${CHECKPOINT_COLUMNS},value`)
      .eq("id", input.checkpointId)
      .eq("room_id", input.roomId)
      .eq("org_id", input.organizationId)
      .maybeSingle()

    if (error) {
      throw new WorkingCopyServiceError("Unable to load the checkpoint.", 500)
    }

    if (!data) {
      throw new WorkingCopyServiceError("That checkpoint is no longer here.", 404)
    }

    const chosen = data as CheckpointRow
    await insertCheckpoint(client, input, deps, {
      copy,
      label: `Before going back to ${chosen.label}`.slice(0, 120),
      restoredFrom: chosen.id,
      revision,
    })
    await broadcastChange(deps, input.roomId, "notes", { by: input.actorUserId, notes: "checkpoints" })

    return chosen.value as WorkingCopy
  })
}

/**
 * The comments on a working copy, oldest first, threads with their replies.
 *
 * @param input - The member, what the room holds, and the room.
 * @param deps - Injected database for tests.
 * @returns Every comment, each named by its author.
 */
export async function listWorkingCopyComments(
  input: RoomNoteInput,
  deps: WorkingCopyServiceDeps = {}
): Promise<WorkingCopyComment[]> {
  return runWorkingCopyOperation("list_working_copy_comments", input, async () => {
    const client = deps.client ?? createAdminClient()
    await requireNoteRoom(client, input, deps)
    const { data, error } = await client
      .from("working_copy_comments")
      .select(COMMENT_COLUMNS)
      .eq("room_id", input.roomId)
      .eq("org_id", input.organizationId)
      .order("created_at", { ascending: true })
      .limit(MOST_COMMENTS)

    if (error || !data) {
      throw new WorkingCopyServiceError("Unable to load comments.", 500)
    }

    return nameComments(client, data as CommentRow[])
  })
}

/**
 * Leaves a comment: a new thread on a block or the page, or a reply to one.
 *
 * @param input - The member, the room, the words, and what they are about.
 * @param deps - Injected database, ids and broadcast for tests.
 * @returns The comment.
 * @throws WorkingCopyServiceError 404 for a block or thread that isn't there.
 */
export async function addWorkingCopyComment(
  input: RoomNoteInput & Readonly<{ blockId?: string | null; body: string; quote?: string | null; threadId?: string | null }>,
  deps: WorkingCopyServiceDeps = {}
): Promise<WorkingCopyComment> {
  return runWorkingCopyOperation("add_working_copy_comment", input, async () => {
    const client = deps.client ?? createAdminClient()
    const body = requireText(input.body, 4_000, "Write a comment of up to 4,000 characters.")
    const { copy } = await readRoom(client, input, deps)
    const id = (deps.createId ?? randomUUID)()
    let thread: { blockId: string | null; quote: string | null; threadId: string }

    if (input.threadId) {
      await requireThread(client, input, input.threadId)
      thread = { blockId: null, quote: null, threadId: input.threadId }
    } else {
      if (input.blockId && !copy.content.blocks.some((block) => block.id === input.blockId)) {
        throw new WorkingCopyServiceError("That part of the page is no longer there.", 404)
      }

      const quote = input.quote?.trim().slice(0, 500) || null
      thread = { blockId: input.blockId ?? null, quote, threadId: id }
    }

    const { data, error } = await client
      .from("working_copy_comments")
      .insert({
        author_id: input.actorUserId,
        block_id: thread.blockId,
        body,
        id,
        org_id: input.organizationId,
        quote: thread.quote,
        room_id: input.roomId,
        thread_id: thread.threadId,
      })
      .select(COMMENT_COLUMNS)
      .single()

    if (error || !data) {
      throw new WorkingCopyServiceError("Unable to keep this comment.", 500)
    }

    await broadcastChange(deps, input.roomId, "notes", { by: input.actorUserId, notes: "comments" })
    return (await nameComments(client, [data as CommentRow]))[0]!
  })
}

/**
 * Resolves a thread, or opens it again.
 *
 * @param input - The member, the room, the thread, and whether it is resolved.
 * @param deps - Injected database, clock and broadcast for tests.
 */
export async function resolveWorkingCopyThread(
  input: RoomNoteInput & Readonly<{ resolved: boolean; threadId: string }>,
  deps: WorkingCopyServiceDeps & { now?: () => Date } = {}
): Promise<void> {
  return runWorkingCopyOperation("resolve_working_copy_thread", input, async () => {
    const client = deps.client ?? createAdminClient()
    await requireNoteRoom(client, input, deps)
    await requireThread(client, input, input.threadId)
    const { error } = await client
      .from("working_copy_comments")
      .update(
        input.resolved
          ? { resolved_at: (deps.now?.() ?? new Date()).toISOString(), resolved_by: input.actorUserId }
          : { resolved_at: null, resolved_by: null }
      )
      .eq("id", input.threadId)
      .eq("thread_id", input.threadId)
      .eq("room_id", input.roomId)
      .eq("org_id", input.organizationId)

    if (error) {
      throw new WorkingCopyServiceError("Unable to change this thread.", 500)
    }

    await broadcastChange(deps, input.roomId, "notes", { by: input.actorUserId, notes: "comments" })
  })
}

/**
 * The chat among everyone editing a working copy, oldest first.
 *
 * @param input - The member, what the room holds, and the room.
 * @param deps - Injected database for tests.
 * @returns Up to the last two hundred messages.
 */
export async function listWorkingCopyMessages(
  input: RoomNoteInput,
  deps: WorkingCopyServiceDeps = {}
): Promise<WorkingCopyChatMessage[]> {
  return runWorkingCopyOperation("list_working_copy_messages", input, async () => {
    const client = deps.client ?? createAdminClient()
    await requireNoteRoom(client, input, deps)
    const { data, error } = await client
      .from("working_copy_messages")
      .select(MESSAGE_COLUMNS)
      .eq("room_id", input.roomId)
      .eq("org_id", input.organizationId)
      .order("created_at", { ascending: false })
      .limit(MOST_MESSAGES)

    if (error || !data) {
      throw new WorkingCopyServiceError("Unable to load the chat.", 500)
    }

    return nameMessages(client, (data as MessageRow[]).reverse())
  })
}

/**
 * Says something in the chat among everyone editing a working copy.
 *
 * @param input - The member, the room, and the words.
 * @param deps - Injected database, ids and broadcast for tests.
 * @returns The message.
 */
export async function sendWorkingCopyMessage(
  input: RoomNoteInput & Readonly<{ body: string }>,
  deps: WorkingCopyServiceDeps = {}
): Promise<WorkingCopyChatMessage> {
  return runWorkingCopyOperation("send_working_copy_message", input, async () => {
    const client = deps.client ?? createAdminClient()
    const body = requireText(input.body, 4_000, "Write a message of up to 4,000 characters.")
    await requireNoteRoom(client, input, deps)
    const { data, error } = await client
      .from("working_copy_messages")
      .insert({ author_id: input.actorUserId, body, id: (deps.createId ?? randomUUID)(), org_id: input.organizationId, room_id: input.roomId })
      .select(MESSAGE_COLUMNS)
      .single()

    if (error || !data) {
      throw new WorkingCopyServiceError("Unable to send this message.", 500)
    }

    await broadcastChange(deps, input.roomId, "notes", { by: input.actorUserId, notes: "chat" })
    return (await nameMessages(client, [data as MessageRow]))[0]!
  })
}

// The member may still edit what the room holds, and the room is that one's.
async function requireNoteRoom(client: WorkingCopyServiceClient, input: RoomNoteInput, deps: WorkingCopyServiceDeps) {
  const subject = subjectOf(client, input, deps)
  await subject.load()
  return { room: await requireRoom(client, input, subject), subject }
}

async function readRoom(client: WorkingCopyServiceClient, input: RoomNoteInput, deps: WorkingCopyServiceDeps): Promise<{ copy: WorkingCopy; revision: number }> {
  const { room } = await requireNoteRoom(client, input, deps)
  const doc = await loadRoomDoc(client, room)

  if (!doc) {
    throw busy()
  }

  return { copy: readWorkingCopy(doc), revision: room.revision }
}

async function insertCheckpoint(
  client: WorkingCopyServiceClient,
  input: RoomNoteInput,
  deps: WorkingCopyServiceDeps,
  checkpoint: Readonly<{ copy: WorkingCopy; label: string; restoredFrom: string | null; revision: number }>
): Promise<CheckpointRow> {
  const { data, error } = await client
    .from("working_copy_checkpoints")
    .insert({
      created_by: input.actorUserId,
      id: (deps.createId ?? randomUUID)(),
      label: checkpoint.label,
      org_id: input.organizationId,
      restored_from: checkpoint.restoredFrom,
      revision: checkpoint.revision,
      room_id: input.roomId,
      schema_version: 1,
      value: checkpoint.copy,
      value_hash: hashOf(checkpoint.copy),
    })
    .select(CHECKPOINT_COLUMNS)
    .single()

  if (error || !data) {
    throw new WorkingCopyServiceError("Unable to keep this checkpoint.", 500)
  }

  return data as CheckpointRow
}

async function requireThread(client: WorkingCopyServiceClient, input: RoomNoteInput, threadId: string): Promise<void> {
  const { data, error } = await client
    .from("working_copy_comments")
    .select("id")
    .eq("id", threadId)
    .eq("thread_id", threadId)
    .eq("room_id", input.roomId)
    .eq("org_id", input.organizationId)
    .maybeSingle()

  if (error) {
    throw new WorkingCopyServiceError("Unable to load this thread.", 500)
  }

  if (!data) {
    throw new WorkingCopyServiceError("That thread is no longer here.", 404)
  }
}

async function namesOf(client: WorkingCopyServiceClient, ids: Array<string | null>): Promise<(id: string | null) => string> {
  const profiles = indexDocumentCollaborationProfiles(
    await listDocumentCollaborationProfiles(client, uniqueDocumentCollaborationProfileIds(ids), () => new WorkingCopyServiceError("Unable to load names.", 500))
  )

  return (id) => resolveDocumentCollaborationDisplayName(id, profiles, "Former member")
}

async function nameCheckpoints(client: WorkingCopyServiceClient, rows: CheckpointRow[]): Promise<WorkingCopyCheckpoint[]> {
  const name = await namesOf(client, rows.map((row) => row.created_by))

  return rows.map((row) => ({
    createdAt: row.created_at,
    createdBy: name(row.created_by),
    id: row.id,
    label: row.label,
    restoredFrom: row.restored_from,
    revision: Number(row.revision),
  }))
}

async function nameComments(client: WorkingCopyServiceClient, rows: CommentRow[]): Promise<WorkingCopyComment[]> {
  const name = await namesOf(client, rows.flatMap((row) => [row.author_id, row.resolved_by]))

  return rows.map((row) => ({
    author: name(row.author_id),
    authorId: row.author_id,
    blockId: row.block_id,
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    quote: row.quote,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by ? name(row.resolved_by) : null,
    threadId: row.thread_id,
  }))
}

async function nameMessages(client: WorkingCopyServiceClient, rows: MessageRow[]): Promise<WorkingCopyChatMessage[]> {
  const name = await namesOf(client, rows.map((row) => row.author_id))

  return rows.map((row) => ({ author: name(row.author_id), authorId: row.author_id, body: row.body, createdAt: row.created_at, id: row.id }))
}

function requireText(value: string, most: number, message: string): string {
  const text = typeof value === "string" ? value.trim() : ""

  if (text.length === 0 || text.length > most) {
    throw new WorkingCopyServiceError(message, 400)
  }

  return text
}
