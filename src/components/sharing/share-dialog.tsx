"use client"

import { type ReactElement, useEffect, useMemo, useState } from "react"

import {
  loadSharingAction,
  setSharingAccessAction,
  setSharingInheritanceAction,
  type SharingResult,
} from "@/app/(dashboard)/documents/sharing-actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { SharingGrant, SharingLevel, SharingPerson, SharingResource, SharingView } from "@/services/document-service"
import { everyoneWho } from "@/services/documents/sharing-words"

type Level = SharingLevel
// An owner admin's role is never shared; they always have access.
type SharableRole = "external_reviewer" | "manager" | "staff"
type Principal = { role: SharableRole } | { userId: string }
type Share = (principal: Principal, level: Level | null) => Promise<void>

const SHAREABLE_ROLES: readonly SharableRole[] = ["manager", "staff", "external_reviewer"]
const ROW = "flex items-center justify-between gap-3 py-2"
const CHOICE =
  "flex w-full items-center justify-between gap-3 rounded-[10px] px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
const SELECT =
  "h-9 rounded-[8px] border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"

/**
 * Who can open a document or a folder, and a place to change it.
 *
 * @param props - The item or items, a name for the title, and the open state.
 * @returns The Share dialog.
 */
export function ShareDialog({
  name,
  onOpenChange,
  open,
  resources,
}: {
  name: string
  onOpenChange: (open: boolean) => void
  open: boolean
  resources: readonly SharingResource[]
}): ReactElement {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {/* The dialog's contents are only mounted while it is open, so each opening starts fresh. */}
      <DialogContent className="max-h-[85dvh] max-w-md grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto">
        <ShareBody name={name} onDone={() => onOpenChange(false)} resources={resources} />
      </DialogContent>
    </Dialog>
  )
}

function ShareBody({ name, onDone, resources }: { name: string; onDone: () => void; resources: readonly SharingResource[] }): ReactElement {
  const [view, setView] = useState<SharingView | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  // A caller may pass a new array each render; the load follows the items, not the array.
  const key = JSON.stringify(resources)
  const items = useMemo(() => JSON.parse(key) as SharingResource[], [key])
  // Templates have three levels and are open or kept to chosen people; there is no folder above them.
  const templates = items.every((item) => item.kind === "template")

  function receive(result: SharingResult): void {
    if (result.ok) {
      setView(result.view)
      setMessage(null)
    } else {
      setMessage(result.message)
    }
  }

  useEffect(() => {
    let current = true
    void loadSharingAction(items)
      .then((result) => current && receive(result))
      .catch(() => current && setMessage("Sharing could not be opened. Try again."))

    return () => {
      current = false
    }
  }, [items])

  async function change(request: Promise<SharingResult>): Promise<void> {
    setBusy(true)
    try {
      const result = await request
      receive(result)

      // Part of a selection may have changed before the rest was refused; show how it stands.
      if (!result.ok && items.length > 1) {
        const now = await loadSharingAction(items)
        if (now.ok) setView(now.view)
      }
    } catch {
      setMessage("Sharing could not be changed. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const share: Share = (principal, level) => change(setSharingAccessAction({ level, principal, resources: items }))

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share “{view?.name ?? name}”</DialogTitle>
      </DialogHeader>
      {message ? (
        <p className="text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      {view ? (
        <>
          {templates ? (
            <OnlyPeopleIChoose
              busy={busy}
              onChange={(restricted) => void change(setSharingInheritanceAction({ inherit: !restricted, resources: items }))}
              restricted={!view.inherit}
            />
          ) : null}
          <WhoHasAccess busy={busy} onChange={share} templates={templates} view={view} />
          <AddPeople busy={busy} onAdd={share} onQuery={setQuery} query={query} view={view} />
          {view.parent ? (
            <FromFolder
              busy={busy}
              onChange={(inherit) => void change(setSharingInheritanceAction({ inherit, resources: items }))}
              view={view}
            />
          ) : null}
        </>
      ) : message ? null : (
        <p className="text-sm text-muted-foreground">Opening…</p>
      )}
      <div className="flex justify-end">
        <Button onClick={onDone}>Done</Button>
      </div>
    </>
  )
}

function WhoHasAccess({ busy, onChange, templates, view }: { busy: boolean; onChange: Share; templates: boolean; view: SharingView }): ReactElement {
  return (
    <section aria-label="People with access">
      <h3 className="text-sm font-medium">People with access</h3>
      <ul className="divide-y divide-border/60">
        {view.owner ? (
          <li className={ROW}>
            <Who person={view.owner} />
            <span className="text-sm text-muted-foreground">Owner, can always edit</span>
          </li>
        ) : null}
        {view.grants.map((grant) => {
          const label = grant.kind === "person" ? grant.person.name : everyoneWho(grant.role)
          const principal: Principal = grant.kind === "person" ? { userId: grant.person.userId } : { role: grant.role as SharableRole }

          return (
            <li className={ROW} key={grantKey(grant)}>
              {grant.kind === "person" ? <Who person={grant.person} /> : <span className="text-sm">{label}</span>}
              <AccessChoice
                busy={busy}
                label={label}
                level={grant.level}
                mixed={grant.mixed === true}
                onChoose={(level) => void onChange(principal, level)}
                templates={templates}
                viewOnly={(grant.kind === "person" ? grant.person.role : grant.role) === "external_reviewer"}
              />
            </li>
          )
        })}
      </ul>
      <p className="pt-1 text-xs text-muted-foreground">
        {view.owner ? "Owner admins always have access." : "Only people who can open all of them are listed. Owner admins and whoever made each one always have access."}
      </p>
    </section>
  )
}

function Who({ person }: { person: SharingPerson }): ReactElement {
  return (
    <span className="min-w-0 text-sm">
      <span className="block truncate">{person.name}</span>
      <span className="block truncate text-xs text-muted-foreground">{person.email}</span>
    </span>
  )
}

function AccessChoice({
  busy,
  label,
  level,
  mixed,
  onChoose,
  templates,
  viewOnly,
}: {
  busy: boolean
  label: string
  level: Level
  /** The selected items give this person different levels. */
  mixed: boolean
  onChoose: (level: Level | null) => void
  /** A template is used as well as viewed or edited. */
  templates: boolean
  viewOnly: boolean
}): ReactElement {
  return (
    <select
      aria-label={`Access for ${label}`}
      className={SELECT}
      disabled={busy}
      onChange={(event) => onChoose(event.target.value === "remove" ? null : (event.target.value as Level))}
      value={mixed ? "mixed" : level}
    >
      {mixed ? (
        <option disabled value="mixed">
          Different on each
        </option>
      ) : null}
      {viewOnly ? (
        <option value="viewer">Can view only</option>
      ) : (
        <>
          <option value="viewer">Can view</option>
          {templates ? <option value="user">Can use</option> : null}
          <option value={templates ? "editor" : "contributor"}>Can edit</option>
        </>
      )}
      <option value="remove">Remove access</option>
    </select>
  )
}

function AddPeople({
  busy,
  onAdd,
  onQuery,
  query,
  view,
}: {
  busy: boolean
  onAdd: Share
  onQuery: (query: string) => void
  query: string
  view: SharingView
}): ReactElement {
  const has = new Set(view.grants.flatMap((grant) => (grant.kind === "person" ? [grant.person.userId] : [])))
  const heldRoles = new Set(view.grants.flatMap((grant) => (grant.kind === "role" ? [grant.role] : [])))
  const needle = query.trim().toLowerCase()
  // The maker and owner admins can always open it, so offering them would do nothing.
  const people = view.members.filter(
    (person) =>
      person.role !== "owner_admin" &&
      person.userId !== view.owner?.userId &&
      !has.has(person.userId) &&
      `${person.name} ${person.email}`.toLowerCase().includes(needle)
  )
  const groups = SHAREABLE_ROLES.filter((role) => !heldRoles.has(role) && everyoneWho(role).toLowerCase().includes(needle))

  return (
    <section aria-label="Add people">
      <h3 className="pb-1.5 text-sm font-medium">Add people</h3>
      <Input aria-label="Find a person or group" onChange={(event) => onQuery(event.target.value)} placeholder="Find a person or group" value={query} />
      {/* A list beside the field, not a pop-up, which would hide this dialog from a screen reader. */}
      <ul aria-label="People you can add" className="mt-1 max-h-44 overflow-y-auto">
        {groups.map((role) => (
          <li key={role}>
            <button className={CHOICE} disabled={busy} onClick={() => void onAdd({ role }, "viewer")} type="button">
              <span>{everyoneWho(role)}</span>
            </button>
          </li>
        ))}
        {people.map((person) => (
          <li key={person.userId}>
            <button className={CHOICE} disabled={busy} onClick={() => void onAdd({ userId: person.userId }, "viewer")} type="button">
              <Who person={person} />
            </button>
          </li>
        ))}
        {people.length + groups.length === 0 ? <li className="px-2.5 py-2 text-sm text-muted-foreground">No one else to add.</li> : null}
      </ul>
    </section>
  )
}

function OnlyPeopleIChoose({ busy, onChange, restricted }: { busy: boolean; onChange: (restricted: boolean) => void; restricted: boolean }): ReactElement {
  return (
    <section aria-label="Who can open it">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium" htmlFor="share-restricted">
          Only people I choose
        </label>
        <Switch checked={restricted} disabled={busy} id="share-restricted" onCheckedChange={onChange} />
      </div>
      <p className="pt-1 text-xs text-muted-foreground">
        {restricted
          ? "Only you, owner admins and the people below can open it."
          : "Everyone who can see templates can use it. Add people below to let them edit it, or turn this on to keep it to them."}
      </p>
    </section>
  )
}

function FromFolder({ busy, onChange, view }: { busy: boolean; onChange: (inherit: boolean) => void; view: SharingView }): ReactElement {
  const folder = view.parent?.name ?? ""

  return (
    <section aria-label={`From the folder ${folder}`}>
      <h3 className="text-sm font-medium">From the folder “{folder}”</h3>
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm" htmlFor="share-inherit">
          Also share with everyone who can open “{folder}”
        </label>
        <Switch checked={view.inherit} disabled={busy} id="share-inherit" onCheckedChange={onChange} />
      </div>
      {view.inherit ? (
        <ul className="divide-y divide-border/60">
          {view.inherited.map((entry) => (
            <li className={ROW} key={`${entry.from}:${entry.label}`}>
              <span className="text-sm">{entry.label}</span>
              <span className="text-sm text-muted-foreground">{entry.level === "contributor" ? "Can edit" : "Can view"}</span>
            </li>
          ))}
          {view.inherited.length === 0 ? <li className="py-2 text-sm text-muted-foreground">Nobody else yet.</li> : null}
        </ul>
      ) : null}
    </section>
  )
}

const grantKey = (grant: SharingGrant): string => (grant.kind === "person" ? grant.person.userId : `role:${grant.role}`)
