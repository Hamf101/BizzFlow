"use client"

import { useEffect, useState } from "react"

import type { LiveSession } from "@/lib/collaboration/live-session"
import type { TemplateContentV3 } from "@/types/template"
import { mapImageAssets } from "@/types/template-images"

/** Where pictures load from in this editor, which a shared copy never keeps. */
export type PictureAddresses = Readonly<{
  /** Puts back the addresses this editor has for a copy's pictures. */
  attach: (content: TemplateContentV3) => TemplateContentV3
  /** Remembers the addresses a copy carries, as for a picture just uploaded. */
  remember: (content: TemplateContentV3) => void
  urls: Map<string, string>
}>

/**
 * Keeps the addresses pictures load from while a working copy is edited live:
 * those the page came with, those of pictures uploaded here, and those
 * fetched for pictures someone else added.
 *
 * @param initial - The content the editor opened with, addresses and all.
 * @returns How to put addresses back and remember new ones.
 */
export function usePictureAddresses(initial: TemplateContentV3): PictureAddresses {
  const [urls] = useState(() => {
    const known = new Map<string, string>()
    collect(known, initial)
    return known
  })

  return {
    attach: (content) =>
      mapImageAssets(content, (asset) => {
        const url = urls.get(asset.id)
        return url ? { ...asset, url } : asset
      }),
    remember: (content) => collect(urls, content),
    urls,
  }
}

/**
 * Fetches addresses for pictures in the room's copy this editor has none for,
 * such as one another editor just added, then shows them.
 *
 * @param options - The copy on screen, the room, and the addresses kept so far.
 */
export function useMissingPictureAddresses(options: Readonly<{
  content: TemplateContentV3
  path: string
  pictures: PictureAddresses
  roomId: string | null
  session: Pick<LiveSession<unknown>, "refresh"> | null
}>): void {
  const { content, path, pictures, roomId, session } = options
  const [fetched, setFetched] = useState(0)

  useEffect(() => {
    const missing = new Set<string>()
    mapImageAssets(content, (asset) => {
      if (!asset.url && !pictures.urls.has(asset.id)) missing.add(asset.id)
      return asset
    })

    if (!session || !roomId || missing.size === 0) {
      return
    }

    let stopped = false
    void fetch(`${path}/pictures`, {
      body: JSON.stringify({ ids: [...missing], roomId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then((response) => (response.ok ? (response.json() as Promise<{ urls: Record<string, string> }>) : null))
      .then((result) => {
        if (!stopped && result) {
          for (const [id, url] of Object.entries(result.urls)) pictures.urls.set(id, url)
          session.refresh()
          setFetched((count) => count + 1)
        }
      })
      .catch(() => undefined)

    return () => {
      stopped = true
    }
  }, [content, fetched, path, pictures, roomId, session])
}

function collect(urls: Map<string, string>, content: TemplateContentV3): void {
  mapImageAssets(content, (asset) => {
    if (asset.url) urls.set(asset.id, asset.url)
    return asset
  })
}
