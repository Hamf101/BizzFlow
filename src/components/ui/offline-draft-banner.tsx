"use client"

import { WifiOff } from "lucide-react"
import { useEffect, useState, type ReactElement } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export function OfflineDraftBanner(): ReactElement | null {
  const [isOffline, setIsOffline] = useState(() =>
    typeof window !== "undefined" ? !navigator.onLine : false
  )

  useEffect(() => {
    const handleOffline = () => setIsOffline(true)
    const handleOnline = () => setIsOffline(false)

    if (typeof window !== "undefined") {
      window.addEventListener("offline", handleOffline)
      window.addEventListener("online", handleOnline)
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("offline", handleOffline)
        window.removeEventListener("online", handleOnline)
      }
    }
  }, [])

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
