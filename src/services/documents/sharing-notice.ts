import type { SharedMessage } from "@/components/sharing/sharing-notices"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SharingNotice } from "@/services/documents/sharing-contracts"

type Send = (topic: string, event: string, message: object) => Promise<void>

/**
 * The private channel a member listens to for word meant for them. A policy on
 * realtime.messages lets each member hear only the one carrying their own id.
 *
 * @param userId - The member.
 * @returns The channel's topic.
 */
export function noticeTopic(userId: string): string {
  return `user:${userId}`
}

/**
 * Tells a member, if they are online, that something was shared with them. The
 * share is already kept, so someone offline simply finds it in Files.
 *
 * @param notice - Who shared what, at what level, with whom.
 * @param send - Sends to a channel; defaults to Supabase Realtime over HTTP.
 * @throws Error when the channel takes no message; the caller decides whether that matters.
 */
export async function broadcastSharingNotice(notice: SharingNotice, send: Send = sendWithRealtime): Promise<void> {
  await sendNotice(
    notice.recipientUserId,
    {
      actorName: notice.actorName,
      ...(notice.count ? { count: notice.count } : {}),
      id: notice.resource.id,
      kind: notice.resource.kind,
      level: notice.level,
      name: notice.resourceName,
    },
    send
  )
}

/**
 * Sends one member the pop-up message, if they are online.
 *
 * @param recipientUserId - Who it is for.
 * @param message - What the pop-up says.
 * @param send - Sends to a channel; defaults to Supabase Realtime over HTTP.
 * @throws Error when the channel takes no message; the caller decides whether that matters.
 */
export async function sendNotice(recipientUserId: string, message: SharedMessage, send: Send = sendWithRealtime): Promise<void> {
  await send(noticeTopic(recipientUserId), "shared", message)
}

async function sendWithRealtime(topic: string, event: string, message: object): Promise<void> {
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
