"use client"

import { useRouter } from "next/navigation"
import { useEffect, type ReactElement } from "react"

import { bizflowToast } from "@/components/ui/toaster"

import { describeShare, playChime, readSharedMessage } from "./sharing-notices"

type Connection = { expiresAt: number | null; key: string; token: string | null; topic: string; url: string }

/**
 * Listens for word that something was shared with the signed-in member and shows
 * it as a pop-up with a chime. Renders nothing. An inbox comes later; until then
 * someone who was offline finds what was shared in Files.
 *
 * @returns Nothing visible.
 */
export function SharingNoticesListener(): ReactElement | null {
  const router = useRouter()

  useEffect(() => {
    let stopped = false
    let stop = (): void => undefined

    void (async () => {
      const first = await readConnection()
      const { RealtimeClient } = await import("@supabase/realtime-js")

      if (stopped) {
        return
      }

      let token = { expiresAt: first.expiresAt ?? 0, value: first.token }
      const client = new RealtimeClient(first.url, {
        accessToken: async () => {
          if (!token.value || token.expiresAt * 1_000 - Date.now() < 60_000) {
            const fresh = await readConnection()
            token = { expiresAt: fresh.expiresAt ?? 0, value: fresh.token }
          }

          return token.value
        },
        params: { apikey: first.key },
      })
      await client.setAuth()

      if (stopped) {
        return
      }

      const channel = client.channel(first.topic, { config: { private: true } })
      channel.on("broadcast", { event: "shared" }, ({ payload }: { payload?: unknown }) => {
        const message = readSharedMessage(payload)

        if (message) {
          const { detail, href, title } = describeShare(message)
          bizflowToast.info(title, {
            action: { label: "Open", onClick: () => router.push(href) },
            description: detail,
            duration: 10_000,
          })
          playChime()
        }
      })
      channel.subscribe()
      stop = () => void client.removeChannel(channel).then(() => client.disconnect())
    })().catch(() => {
      // Live notices are a courtesy; the share itself is already kept.
    })

    return () => {
      stopped = true
      stop()
    }
  }, [router])

  return null
}

async function readConnection(): Promise<Connection> {
  const response = await fetch("/api/notices/connect", { cache: "no-store" })

  if (!response.ok) {
    throw new Error("Notices unavailable")
  }

  return (await response.json()) as Connection
}
