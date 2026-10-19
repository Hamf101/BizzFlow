"use client"

import { Crown, Plus, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { type DragEvent, type FormEvent, type ReactElement, useState, useTransition } from "react"

import type { StructureChange } from "@/app/(dashboard)/settings/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { bizflowToast } from "@/components/ui/toaster"
import { useMediaQuery } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"
import type { OrganizationStructure } from "@/services/organization-service"
import type { OrganizationMember } from "@/types/organization"

type Unit = OrganizationStructure["units"][number]
type Change = (input: StructureChange) => Promise<{ error?: string }>
/** A move waiting for the owner to confirm what it changes. */
type Pending = { userId: string; from: string | null; to: string }

const REACH = { branch: "their teams and reporting line", everyone: "everyone", inviter: "their inviter's side" } as const

/**
 * The workspace as a tree of teams: drag someone onto a team, or open them to
 * move them, lead a team, or say who they report to. Before a move saves, it
 * says who they will stop and start seeing, and it can be undone after.
 *
 * @param props - The structure, the members, the workspace's name and the action that saves a change.
 * @returns The org chart.
 */
export function OrgChart({
  change,
  members,
  structure,
  workspaceName,
}: {
  change: Change
  members: readonly OrganizationMember[]
  structure: OrganizationStructure
  workspaceName: string
}): ReactElement {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [pending, setPending] = useState<Pending | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  // A phone opens a person as a sheet; wider screens beside the chart.
  const wide = useMediaQuery("(min-width: 48rem)")
  const name = (userId: string): string => {
    const member = members.find((candidate) => candidate.userId === userId)
    return member?.workspaceDisplayName || member?.fullName || member?.email || "Former member"
  }
  const unitsOf = (userId: string): Unit[] => structure.units.filter((unit) => unit.members.some((placed) => placed.userId === userId))
  const placed = new Set(structure.units.flatMap((unit) => unit.members.map((member) => member.userId)))
  const unplaced = members.filter((member) => !placed.has(member.userId))
  const roots = structure.units.filter((unit) => !unit.parentId || !structure.units.some((other) => other.id === unit.parentId))

  function save(steps: StructureChange[], done?: () => void): void {
    startTransition(async () => {
      for (const step of steps) {
        const { error } = await change(step)

        if (error) {
          bizflowToast.error("Not saved", { description: error })
          router.refresh()
          return
        }
      }

      done?.()
      router.refresh()
    })
  }

  function move({ from, to, userId }: Pending): void {
    const wasLead = structure.units.find((unit) => unit.id === from)?.members.find((member) => member.userId === userId)?.isLead
    const there: StructureChange[] = [
      { kind: "set_unit_member", place: "member", unitId: to, userId },
      ...(from ? [{ kind: "set_unit_member", place: null, unitId: from, userId } as const] : []),
    ]
    const back: StructureChange[] = [
      ...(from ? [{ kind: "set_unit_member", place: wasLead ? "lead" : "member", unitId: from, userId } as const] : []),
      { kind: "set_unit_member", place: null, unitId: to, userId },
    ]
    setPending(null)
    save(there, () =>
      bizflowToast.success(`Moved ${name(userId)} to ${structure.units.find((unit) => unit.id === to)?.name}`, {
        action: { label: "Undo", onClick: () => save(back) },
      })
    )
  }

  function ask(userId: string, to: string, from?: string | null): void {
    const source = from === undefined ? (unitsOf(userId)[0]?.id ?? null) : from
    if (source !== to) setPending({ from: source, to, userId })
  }

  const person = selected ? members.find((member) => member.userId === selected) : undefined
  const panel = person ? (
    <PersonPanel
      ask={ask}
      busy={busy}
      close={() => setSelected(null)}
      managers={structure.managers}
      member={person}
      members={members}
      name={name}
      reach={reachOf(person, structure)}
      save={save}
      units={structure.units}
      unitsOf={unitsOf}
      wide={wide}
    />
  ) : null

  return (
    <div aria-busy={busy} className={cn("grid gap-6", person && "md:grid-cols-[minmax(0,1fr)_20rem]")}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="org-tree overflow-x-auto rounded-xl bg-muted/40 p-4 md:p-8">
          <div className="flex md:justify-center">
            <div className="rounded-lg border bg-card px-4 py-3 text-sm font-semibold">{workspaceName}</div>
          </div>
          <ul>
            {roots.map((unit) => (
              <TeamNode ask={ask} key={unit.id} name={name} save={save} select={setSelected} selected={selected} unit={unit} units={structure.units} />
            ))}
            <li>
              <NewTeam label="New team" onAdd={(teamName) => save([{ kind: "save_unit", name: teamName, parentId: null }])} />
            </li>
          </ul>
        </div>

        {unplaced.length > 0 ? (
          <section aria-label="Not in a team yet" className="flex flex-col gap-2 rounded-xl border border-dashed p-4">
            <h3 className="text-sm font-medium">
              Not in a team yet <span className="font-normal text-muted-foreground">They still see what their role allows.</span>
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {unplaced.map((member) => (
                <PersonChip key={member.userId} name={name(member.userId)} onOpen={() => setSelected(member.userId)} selected={selected === member.userId} userId={member.userId} />
              ))}
            </div>
          </section>
        ) : null}

        {pending ? (
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl bg-foreground p-4 text-background shadow-lg" role="status">
            <p className="min-w-0 flex-1 text-sm">{describeMove(pending, structure, members, name)}</p>
            <Button className="text-background hover:bg-background/10 hover:text-background" onClick={() => setPending(null)} type="button" variant="ghost">
              Cancel
            </Button>
            <Button onClick={() => move(pending)} type="button" variant="secondary">
              Move {name(pending.userId)}
            </Button>
          </div>
        ) : null}
      </div>

      {panel && wide ? <aside className="flex flex-col gap-5 self-start rounded-xl border bg-card p-5">{panel}</aside> : null}
      <Sheet onOpenChange={(open) => (open ? null : setSelected(null))} open={Boolean(person) && !wide}>
        <SheetContent className="flex flex-col gap-5 p-4">{panel}</SheetContent>
      </Sheet>
    </div>
  )
}

function TeamNode({
  ask,
  name,
  save,
  select,
  selected,
  unit,
  units,
}: {
  ask: (userId: string, to: string, from?: string | null) => void
  name: (userId: string) => string
  save: (steps: StructureChange[]) => void
  select: (userId: string) => void
  selected: string | null
  unit: Unit
  units: readonly Unit[]
}): ReactElement {
  const [over, setOver] = useState(false)
  const children = units.filter((other) => other.parentId === unit.id)

  function drop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setOver(false)
    const [userId, from] = event.dataTransfer.getData("text/x-bizflow-person").split("|")
    if (userId) ask(userId, unit.id, from || null)
  }

  return (
    <li>
      <div
        className={cn(
          "flex w-full flex-col gap-2.5 rounded-lg border bg-card p-3 transition-colors md:w-64",
          over && "border-primary bg-secondary"
        )}
        data-slot="team"
        onDragLeave={() => setOver(false)}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDrop={drop}
      >
        <div className="flex items-center gap-1">
          <Input
            aria-label={`Name of ${unit.name}`}
            className="h-8 border-transparent px-1.5 font-medium shadow-none hover:border-input"
            defaultValue={unit.name}
            maxLength={80}
            onBlur={(event) => {
              const next = event.target.value.trim()
              if (next && next !== unit.name) save([{ kind: "save_unit", name: next, parentId: unit.parentId, unitId: unit.id }])
            }}
          />
          <Button
            aria-label={`Delete ${unit.name}`}
            onClick={() => {
              if (window.confirm(`Delete ${unit.name}${children.length ? " and the teams inside it" : ""}? Nobody's account changes.`)) {
                save([{ kind: "delete_unit", unitId: unit.id }])
              }
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {unit.members.length === 0 ? <span className="px-1 text-xs text-muted-foreground">Drag someone here</span> : null}
          {unit.members.map((member) => (
            <PersonChip
              from={unit.id}
              key={member.userId}
              lead={member.isLead}
              name={name(member.userId)}
              onOpen={() => select(member.userId)}
              selected={selected === member.userId}
              userId={member.userId}
            />
          ))}
        </div>
        <NewTeam label={`New team in ${unit.name}`} onAdd={(teamName) => save([{ kind: "save_unit", name: teamName, parentId: unit.id }])} quiet />
      </div>
      {children.length > 0 ? (
        <ul>
          {children.map((child) => (
            <TeamNode ask={ask} key={child.id} name={name} save={save} select={select} selected={selected} unit={child} units={units} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function PersonChip({
  from,
  lead = false,
  name,
  onOpen,
  selected,
  userId,
}: {
  from?: string
  lead?: boolean
  name: string
  onOpen: () => void
  selected: boolean
  userId: string
}): ReactElement {
  return (
    <button
      aria-pressed={selected}
      className="inline-flex min-h-11 cursor-grab items-center gap-1.5 rounded-full border border-transparent bg-muted px-3 text-sm outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing aria-pressed:border-primary aria-pressed:bg-secondary md:min-h-8"
      draggable
      onClick={onOpen}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/x-bizflow-person", `${userId}|${from ?? ""}`)
        event.dataTransfer.effectAllowed = "move"
      }}
      type="button"
    >
      {name}
      {lead ? <Crown aria-label="Lead" className="size-3.5 text-warning" role="img" /> : null}
    </button>
  )
}

function PersonPanel({
  ask,
  busy,
  wide,
  close,
  managers,
  member,
  members,
  name,
  reach,
  save,
  units,
  unitsOf,
}: {
  ask: (userId: string, to: string, from?: string | null) => void
  busy: boolean
  close: () => void
  managers: Readonly<Record<string, string>>
  member: OrganizationMember
  members: readonly OrganizationMember[]
  name: (userId: string) => string
  reach: string
  save: (steps: StructureChange[]) => void
  units: readonly Unit[]
  unitsOf: (userId: string) => Unit[]
  wide: boolean
}): ReactElement {
  const mine = unitsOf(member.userId)
  const first = mine[0]

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          {wide ? <h3 className="text-lg font-semibold">{name(member.userId)}</h3> : <SheetTitle className="text-lg font-semibold">{name(member.userId)}</SheetTitle>}
          <p className="text-sm text-muted-foreground">
            {member.roleName ?? member.role}, sees {reach}
          </p>
        </div>
        <Button aria-label="Close" onClick={close} size="icon" type="button" variant="ghost">
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted-foreground">Team</span>
        <Select aria-label="Team" disabled={busy} onChange={(event) => event.target.value && ask(member.userId, event.target.value, first?.id ?? null)} value={first?.id ?? ""}>
          {first ? null : <option value="">Not in a team</option>}
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </Select>
      </label>

      {first ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              save([{ kind: "set_unit_member", place: first.members.find((placed) => placed.userId === member.userId)?.isLead ? "member" : "lead", unitId: first.id, userId: member.userId }])
            }
            type="button"
            variant="outline"
          >
            <Crown aria-hidden="true" className="size-4" />
            {first.members.find((placed) => placed.userId === member.userId)?.isLead ? `Stop leading ${first.name}` : `Lead ${first.name}`}
          </Button>
          <Button disabled={busy} onClick={() => save([{ kind: "set_unit_member", place: null, unitId: first.id, userId: member.userId }])} type="button" variant="ghost">
            Take out of {first.name}
          </Button>
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted-foreground">Reports to</span>
        <Select
          aria-label="Reports to"
          disabled={busy}
          onChange={(event) => save([{ kind: "set_manager", managerUserId: event.target.value || null, userId: member.userId }])}
          value={managers[member.userId] ?? ""}
        >
          <option value="">Nobody</option>
          {members
            .filter((other) => other.userId !== member.userId)
            .map((other) => (
              <option key={other.userId} value={other.userId}>
                {name(other.userId)}
              </option>
            ))}
        </Select>
      </label>
    </>
  )
}

function NewTeam({ label, onAdd, quiet = false }: { label: string; onAdd: (name: string) => void; quiet?: boolean }): ReactElement {
  const [value, setValue] = useState("")

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        if (value.trim()) {
          onAdd(value.trim())
          setValue("")
        }
      }}
    >
      <Input aria-label={label} className={quiet ? "h-8 text-xs" : "h-9 bg-card md:w-56"} maxLength={80} onChange={(event) => setValue(event.target.value)} placeholder={label} value={value} />
      <Button aria-label={`Add ${label.toLowerCase()}`} disabled={!value.trim()} size="icon" type="submit" variant={quiet ? "ghost" : "outline"}>
        <Plus aria-hidden="true" className="size-4" />
      </Button>
    </form>
  )
}

function reachOf(member: OrganizationMember, structure: OrganizationStructure): string {
  const role = structure.roles.find((candidate) => candidate.id === member.roleDefinitionId)
  return REACH[role?.scope ?? "everyone"]
}

/**
 * Says what a move changes for the person moved, in names: whom their team
 * stops and starts showing them, and that their manager still sees their work.
 */
export function describeMove(
  { from, to, userId }: Pending,
  structure: OrganizationStructure,
  members: readonly OrganizationMember[],
  name: (userId: string) => string
): string {
  const member = members.find((candidate) => candidate.userId === userId)
  const target = structure.units.find((unit) => unit.id === to)
  const who = name(userId)
  const head = `Move ${who} to ${target?.name ?? "that team"}?`

  if (member && reachOf(member, structure) === REACH.everyone) {
    return `${head} ${who}'s role sees everyone, so only their team changes.`
  }

  const manager = structure.managers[userId]
  // Placed nowhere, a branch role still sees everyone; a team narrows it.
  if (from === null && !manager) {
    const team = (target?.members ?? []).map((placed) => placed.userId).filter((id) => id !== userId)
    return `${head} Once in a team, ${who} sees only their teams and reporting line${team.length ? `: ${team.map(name).join(", ")}` : ""}.`
  }
  const mates = (unitId: string | null): string[] =>
    (structure.units.find((unit) => unit.id === unitId)?.members ?? []).map((placed) => placed.userId).filter((id) => id !== userId && id !== manager)
  const before = mates(from)
  const after = mates(to)
  const list = (ids: string[]): string => {
    const names = ids.map(name)
    return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
  }
  const lost = before.filter((id) => !after.includes(id))
  const gained = after.filter((id) => !before.includes(id))
  const parts = [
    lost.length ? `${who} stops seeing ${list(lost)}` : null,
    gained.length ? `${lost.length ? "and starts" : `${who} starts`} seeing ${list(gained)}` : null,
  ].filter(Boolean)
  const sees = parts.length ? `${parts.join(", ")}.` : `Who ${who} sees stays the same.`

  return `${head} ${sees}${manager ? ` ${name(manager)} still manages ${who} and sees what they submit.` : ""}`
}
