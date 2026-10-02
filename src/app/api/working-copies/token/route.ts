import { renewRoomToken } from "@/app/api/_working-copy-room"

/** A fresh access token for a room's live channel. */
export async function GET(): Promise<Response> {
  return renewRoomToken()
}
