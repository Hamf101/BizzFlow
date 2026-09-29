import { readRoomUpdates, sendRoomUpdate } from "@/app/api/_working-copy-room"

type Context = { params: Promise<{ templateId: string }> }

/** Keeps one change to a template's working copy. */
export async function POST(request: Request, context: Context): Promise<Response> {
  return sendRoomUpdate(request, { templateId: (await context.params).templateId })
}

/** Catches an editor up with the changes kept after a revision. */
export async function GET(request: Request, context: Context): Promise<Response> {
  return readRoomUpdates(request, { templateId: (await context.params).templateId })
}
