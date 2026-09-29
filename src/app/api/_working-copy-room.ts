import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { getPublicSupabaseEnv } from "@/lib/env"
import { checkRateLimit, type RateLimitBucket } from "@/lib/rate-limit"
import { readTrustedJsonObject } from "@/lib/request-security"
import { createClient } from "@/lib/supabase/server"
import { getCurrentOrganizationContext, OrganizationServiceError } from "@/services/organization-service"
import {
  addWorkingCopyComment,
  applyWorkingCopyUpdate,
  listWorkingCopyCheckpoints,
  listWorkingCopyComments,
  listWorkingCopyMessages,
  openWorkingCopyRoom,
  readWorkingCopySince,
  resolveWorkingCopyThread,
  restoreWorkingCopyCheckpoint,
  saveWorkingCopyCheckpoint,
  sendWorkingCopyMessage,
  signWorkingCopyPictures,
} from "@/services/working-copy-service"

import { createTemplateRouteErrorResponse } from "./templates/_utils"

/** What a room holds: a template's working copy, or a draft document. */
export type RoomSubject = Readonly<{ documentId: string }> | Readonly<{ templateId: string }>

/**
 * Opens a room: what it holds so far, and how to hear the others in it.
 *
 * @param subject - The template or document.
 * @returns The room's state, revision and channel, or a safe error.
 */
export async function openRoom(subject: RoomSubject): Promise<Response> {
  try {
    const member = await startRoomRequest("working_copy_read")
    const room = await openWorkingCopyRoom({ ...member, ...subject })
    const env = getPublicSupabaseEnv()

    return NextResponse.json({
      realtime: { key: env.SUPABASE_PUBLISHABLE_KEY, url: `${env.SUPABASE_URL}/realtime/v1`, ...(await readRealtimeToken()) },
      revision: room.revision,
      roomId: room.roomId,
      state: Buffer.from(room.state).toString("base64"),
      topic: room.topic,
    })
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "working_copy_room_open", "Unable to open this for editing.")
  }
}

/**
 * Keeps one change.
 *
 * @param request - JSON with the room id and the Yjs update, in base64.
 * @param subject - The template or document.
 * @returns The revision the room is at with the change, or a safe error.
 */
export async function sendRoomUpdate(request: Request, subject: RoomSubject): Promise<Response> {
  try {
    const member = await startRoomRequest("working_copy_write")
    const body = await readTrustedJsonObject(request)
    const update = typeof body.update === "string" ? new Uint8Array(Buffer.from(body.update, "base64")) : new Uint8Array()

    return NextResponse.json(await applyWorkingCopyUpdate({ ...member, ...subject, roomId: readRoomId(body.roomId), update }))
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "working_copy_room_update", "Unable to keep this change.")
  }
}

/**
 * Catches an editor up with the changes kept after a revision.
 *
 * @param request - Query with the room id and the revision the editor has.
 * @param subject - The template or document.
 * @returns Updates in base64, in order, and the revision they reach.
 */
export async function readRoomUpdates(request: Request, subject: RoomSubject): Promise<Response> {
  try {
    const member = await startRoomRequest("working_copy_read")
    const query = new URL(request.url).searchParams
    const after = Number(query.get("after"))
    const result = await readWorkingCopySince({
      ...member,
      ...subject,
      afterRevision: Number.isSafeInteger(after) && after >= 0 ? after : 0,
      roomId: readRoomId(query.get("roomId")),
    })

    return NextResponse.json({
      revision: result.revision,
      updates: result.updates.map((update: Uint8Array) => Buffer.from(update).toString("base64")),
    })
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "working_copy_room_since", "Unable to load the latest changes.")
  }
}

/**
 * Addresses for pictures in the room's copy this editor can't show yet, such
 * as one another editor just added.
 *
 * @param request - JSON with the room id and the pictures' ids.
 * @param subject - The template or document.
 * @returns Each picture's address, by id.
 */
export async function signRoomPictures(request: Request, subject: RoomSubject): Promise<Response> {
  try {
    const member = await startRoomRequest("working_copy_read")
    const body = await readTrustedJsonObject(request)
    const assetIds = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : []
    const urls = await signWorkingCopyPictures({ ...member, ...subject, assetIds, roomId: readRoomId(body.roomId) })

    return NextResponse.json({ urls }, { headers: { "Cache-Control": "no-store" } })
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "working_copy_room_pictures", "Unable to show this picture.")
  }
}

/**
 * Reads what people left beside a room's working copy: its checkpoints, its
 * comments, or the chat among everyone editing it.
 *
 * @param request - Query with the room id and which of the three.
 * @param subject - The template or document.
 * @returns The list, or a safe error.
 */
export async function readRoomNotes(request: Request, subject: RoomSubject): Promise<Response> {
  try {
    const member = await startRoomRequest("working_copy_read")
    const query = new URL(request.url).searchParams
    const room = { ...member, ...subject, roomId: readRoomId(query.get("roomId")) }
    const kind = query.get("kind")
    const notes =
      kind === "checkpoints"
        ? await listWorkingCopyCheckpoints(room)
        : kind === "comments"
          ? await listWorkingCopyComments(room)
          : kind === "chat"
            ? await listWorkingCopyMessages(room)
            : null

    if (!notes) {
      throw new OrganizationServiceError("Ask for checkpoints, comments or the chat.", 400)
    }

    return NextResponse.json({ notes }, { headers: { "Cache-Control": "no-store" } })
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "working_copy_room_notes", "Unable to load this.")
  }
}

/**
 * Leaves something beside a room's working copy: a checkpoint, a comment, a
 * thread resolved or opened again, a chat message; or brings a checkpoint back.
 *
 * @param request - JSON with the room id, what to do, and its details.
 * @param subject - The template or document.
 * @returns What was kept, or a safe error.
 */
export async function writeRoomNotes(request: Request, subject: RoomSubject): Promise<Response> {
  try {
    const member = await startRoomRequest("working_copy_write")
    const body = await readTrustedJsonObject(request)
    const room = { ...member, ...subject, roomId: readRoomId(body.roomId) }
    const text = (key: string): string => (typeof body[key] === "string" ? (body[key] as string) : "")
    const id = (key: string): string | null => (typeof body[key] === "string" && UUID.test(body[key] as string) ? (body[key] as string) : null)

    switch (body.action) {
      case "checkpoint":
        return NextResponse.json({ checkpoint: await saveWorkingCopyCheckpoint({ ...room, label: text("label") }) })
      case "restore":
        return NextResponse.json({ copy: await restoreWorkingCopyCheckpoint({ ...room, checkpointId: id("checkpointId") ?? "" }) })
      case "comment":
        return NextResponse.json({
          comment: await addWorkingCopyComment({ ...room, blockId: id("blockId"), body: text("body"), quote: text("quote") || null, threadId: id("threadId") }),
        })
      case "resolve":
        await resolveWorkingCopyThread({ ...room, resolved: body.resolved === true, threadId: id("threadId") ?? "" })
        return new Response(null, { status: 204 })
      case "message":
        return NextResponse.json({ message: await sendWorkingCopyMessage({ ...room, body: text("body") }) })
      default:
        throw new OrganizationServiceError("That can't be done here.", 400)
    }
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "working_copy_room_notes", "Unable to keep this.")
  }
}

/**
 * A fresh access token for the room's live channel, before the last one runs out.
 *
 * @returns The token and when it expires.
 */
export async function renewRoomToken(): Promise<Response> {
  try {
    await startRoomRequest("working_copy_read")
    return NextResponse.json(await readRealtimeToken(), { headers: { "Cache-Control": "no-store" } })
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "working_copy_token", "Unable to reconnect.")
  }
}

// Signs the member in, spends one request from a room budget, and names the
// organization they are working in, read from their session rather than the request.
async function startRoomRequest(bucket: RateLimitBucket): Promise<{ actorUserId: string; organizationId: string }> {
  const user = await getAuthenticatedUser()
  await checkRateLimit(bucket, user.id)
  const context = await getCurrentOrganizationContext(user.id)

  if (!context) {
    throw new OrganizationServiceError("Create or join an organization first.", 403)
  }

  return { actorUserId: user.id, organizationId: context.organization.id }
}

// The member's own access token, which the browser shows Realtime to join the
// room's private channel; Realtime checks it against the room.
async function readRealtimeToken(): Promise<{ expiresAt: number | null; token: string | null }> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getSession()

  return { expiresAt: data.session?.expires_at ?? null, token: data.session?.access_token ?? null }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readRoomId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new OrganizationServiceError("That working copy is not open here.", 400)
  }

  return value
}
