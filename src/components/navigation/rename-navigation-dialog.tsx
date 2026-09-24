"use client"

import { useState, type ReactElement } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/** Lets an owner edit a shared name; keeps the dialog open when saving fails. */
export function RenameNavigationDialog({ label, saving, error, onSave, onClose }: {
  label: string; saving: boolean; error: string | null; onSave: (label: string) => Promise<boolean>; onClose: () => void
}): ReactElement {
  const [name, setName] = useState(label)
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
    <DialogContent>
      <DialogTitle>Rename tab</DialogTitle>
      <DialogDescription>This name will appear for everyone in this workspace.</DialogDescription>
      <form className="flex flex-col gap-5" onSubmit={async (event) => { event.preventDefault(); if (await onSave(name.trim())) onClose() }}>
        <Field><FieldLabel htmlFor="navigation-tab-name">Tab name</FieldLabel><Input id="navigation-tab-name" name="label" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required autoFocus disabled={saving} /></Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save name"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
