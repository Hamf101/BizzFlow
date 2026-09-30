"use client"

import { type ReactElement, useSyncExternalStore } from "react"

import { FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"

import { noticeSoundOn, setNoticeSound, watchNoticeSound } from "./sharing-notices"

/**
 * Chooses whether this device chimes when something is shared with the member.
 * The choice belongs to the device, so it is kept there rather than on the account.
 *
 * @returns A labelled switch.
 */
export function NoticeSoundSwitch(): ReactElement {
  const on = useSyncExternalStore(watchNoticeSound, noticeSoundOn, () => true)

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <FieldLabel className="text-base" htmlFor="noticeSound">
          Sound when something is shared with you
        </FieldLabel>
        <p className="text-sm text-muted-foreground">This device only.</p>
      </div>
      <Switch checked={on} id="noticeSound" onCheckedChange={setNoticeSound} />
    </div>
  )
}
