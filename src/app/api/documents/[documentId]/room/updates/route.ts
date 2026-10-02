import { readRoomUpdates, sendRoomUpdate } from "@/app/api/_working-copy-room"

type Context = { params: Promise<{ documentId: string }> }

/** Keeps one change to a draft document. */
export async function POST(request: Request, context: Context): Promise<Response> {
  return sendRoomUpdate(request, { documentId: (await context.params).documentId })
}

/** Catches an editor up with the changes kept after a revision. */
export async function GET(request: Request, context: Context): Promise<Response> {
  return readRoomUpdates(request, { documentId: (await context.params).documentId })
}
