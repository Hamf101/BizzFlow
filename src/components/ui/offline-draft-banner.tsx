"use client"

import { WifiOff } from "lucide-react"
import { type ReactElement, useSyncExternalStore } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

function subscribeToConnection(onChange: () => void): () => void {
  window.addEventListener("offline", onChange)
  window.addEventListener("online", onChange)

  return () => {
    window.removeEventListener("offline", onChange)
    window.removeEventListener("online", onChange)
  }
}

export function OfflineDraftBanner(): ReactElement | null {
  // Online on the server and while its page is taken over, so the two agree.
  const isOffline = useSyncExternalStore(subscribeToConnection, () => !navigator.onLine, () => false)

  if (!isOffline) return null

  return (
    <div className="fixed right-4 bottom-[calc(3.5rem+1rem+env(safe-area-inset-bottom))] z-50 max-w-md md:bottom-4 animate-in fade-in slide-in-from-bottom-5">
      <Alert variant="destructive">
        <WifiOff className="size-4" />
        <AlertTitle className="flex items-center gap-2">
          <span>You are offline</span>
        </AlertTitle>
        <AlertDescription className="text-xs">
          Saving and submitting are unavailable until your connection is
          restored. Keep this tab open so your unsaved input is not lost.
        </AlertDescription>
      </Alert>
    </div>
  )
}
