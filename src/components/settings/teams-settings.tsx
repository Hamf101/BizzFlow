"use client"

import { Crown, Plus, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, type ReactElement, useState, useTransition } from "react"

import type { StructureChange } from "@/app/(dashboard)/settings/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { bizflowToast } from "@/components/ui/toaster"
import type { OrganizationStructure } from "@/services/organization-service"
import type { OrganizationMember } from "@/types/organization"

type Unit = OrganizationStructure["units"][number]

const REACH_LABELS = {
  everyone: "Everyone",
  branch: "Their teams and reporting line",
  inviter: "Their inviter's side",
} as const

/**
 * Where everyone sits: teams nested to any depth, who leads them, who reports
 * to whom, and how far each role sees. Each change saves as it is made.
 *
 * @param props - The structure, the members to place, and the action that saves a change.
 * @returns The teams card.
 */
export function TeamsSettings({
  change,
  members,
  structure,
}: {
  change: (input: StructureChange) => Promise<{ error?: string }>
  members: readonly OrganizationMember[]
  structure: OrganizationStructure
}): ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const name = (userId: string): string => {
    const member = members.find((candidate) => candidate.userId === userId)
    return member?.workspaceDisplayName || member?.fullName || member?.email || "Former member"
  }

  function save(input: StructureChange): void {
    startTransition(async () => {
      const { error } = await change(input)

      if (error) {
        bizflowToast.error("Not saved", { description: error })
        return
      }

      router.refresh()
    })
  }

  const roots = structure.units.filter((unit) => !unit.parentId || !structure.units.some((other) => other.id === unit.parentId))

  return (
    <Card aria-busy={pending}>
      <CardHeader>
        <CardTitle>Teams and reporting lines</CardTitle>
        <CardDescription>
          What someone sees follows their role&apos;s reach and where they sit here. Anyone you haven&apos;t placed still sees
          everyone.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section aria-label="Teams" className="flex flex-col gap-2">
          {roots.map((unit) => (
            <TeamRow depth={0} key={unit.id} members={members} name={name} save={save} unit={unit} units={structure.units} />
          ))}
          <NewTeam label="New team" onAdd={(teamName) => save({ kind: "save_unit", name: teamName, parentId: null })} />
        </section>

        <section aria-label="Reporting lines" className="flex flex-col gap-2 border-t pt-5">
          <h3 className="text-sm font-medium">Reports to</h3>
          {members.map((member) => (
            <div className="grid gap-1.5 sm:flex sm:items-center sm:justify-between sm:gap-2" key={member.userId}>
              <span className="min-w-0 truncate text-sm">{name(member.userId)}</span>
              <Select
                aria-label={`Who ${name(member.userId)} reports to`}
                className="w-full sm:w-56"
                onChange={(event) => save({ kind: "set_manager", userId: member.userId, managerUserId: event.target.value || null })}
                value={structure.managers[member.userId] ?? ""}
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
            </div>
          ))}
        </section>

        <section aria-label="What each role sees" className="flex flex-col gap-2 border-t pt-5">
          <h3 className="text-sm font-medium">What each role sees</h3>
          {structure.roles
            .filter((role) => role.systemKey !== "owner_admin")
            .map((role) => (
              <div className="grid gap-1.5 sm:flex sm:items-center sm:justify-between sm:gap-2" key={role.id}>
                <span className="text-sm">{role.name}</span>
                <Select
                  aria-label={`What ${role.name} sees`}
                  className="w-full sm:w-72"
                  onChange={(event) => save({ kind: "set_role_scope", roleId: role.id, scope: event.target.value as keyof typeof REACH_LABELS })}
                  value={role.scope}
                >
                  {Object.entries(REACH_LABELS).map(([scope, label]) => (
                    <option key={scope} value={scope}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
        </section>
      </CardContent>
    </Card>
  )
}

function TeamRow({
  depth,
  members,
  name,
  save,
  unit,
  units,
}: {
  depth: number
  members: readonly OrganizationMember[]
  name: (userId: string) => string
  save: (input: StructureChange) => void
  unit: Unit
  units: readonly Unit[]
}): ReactElement {
  const children = units.filter((other) => other.parentId === unit.id)
  const outside = members.filter((member) => !unit.members.some((placed) => placed.userId === member.userId))

  return (
    <div className="flex flex-col gap-2" style={{ paddingLeft: `${depth * 1.25}rem` }}>
      <div className="flex flex-col gap-2 rounded-lg border p-3" data-slot="team">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Team name"
            className="h-8 w-48 font-medium"
            defaultValue={unit.name}
            maxLength={80}
            onBlur={(event) => {
              const next = event.target.value.trim()
              if (next && next !== unit.name) save({ kind: "save_unit", unitId: unit.id, name: next, parentId: unit.parentId })
            }}
          />
          <Button
            aria-label={`Delete ${unit.name}`}
            onClick={() => {
              if (window.confirm(`Delete ${unit.name}${children.length ? " and the teams inside it" : ""}? Nobody's account changes.`)) {
                save({ kind: "delete_unit", unitId: unit.id })
              }
            }}
            size="icon"
            variant="ghost"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {unit.members.map((placed) => (
            <span className="inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-xs" key={placed.userId}>
              {name(placed.userId)}
              <button
                aria-label={placed.isLead ? `${name(placed.userId)} leads ${unit.name}; make them a member` : `Make ${name(placed.userId)} lead ${unit.name}`}
                aria-pressed={placed.isLead}
                className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted aria-pressed:text-warning"
                onClick={() => save({ kind: "set_unit_member", unitId: unit.id, userId: placed.userId, place: placed.isLead ? "member" : "lead" })}
                type="button"
              >
                <Crown className="size-3" />
              </button>
              <button
                aria-label={`Take ${name(placed.userId)} out of ${unit.name}`}
                className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                onClick={() => save({ kind: "set_unit_member", unitId: unit.id, userId: placed.userId, place: null })}
                type="button"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {outside.length > 0 ? (
            <Select
              aria-label={`Add someone to ${unit.name}`}
              className="h-7 w-44 text-xs"
              onChange={(event) => event.target.value && save({ kind: "set_unit_member", unitId: unit.id, userId: event.target.value, place: "member" })}
              value=""
            >
              <option value="">Add someone…</option>
              {outside.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {name(member.userId)}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
        <NewTeam label={`New team in ${unit.name}`} onAdd={(teamName) => save({ kind: "save_unit", name: teamName, parentId: unit.id })} quiet />
      </div>
      {children.map((child) => (
        <TeamRow depth={depth + 1} key={child.id} members={members} name={name} save={save} unit={child} units={units} />
      ))}
    </div>
  )
}

function NewTeam({ label, onAdd, quiet = false }: { label: string; onAdd: (name: string) => void; quiet?: boolean }): ReactElement {
  const [value, setValue] = useState("")

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        if (value.trim()) {
          onAdd(value.trim())
          setValue("")
        }
      }}
    >
      <Input aria-label={label} className={quiet ? "h-7 w-44 text-xs" : "h-8 w-56"} maxLength={80} onChange={(event) => setValue(event.target.value)} placeholder={label} value={value} />
      <Button disabled={!value.trim()} size="sm" type="submit" variant={quiet ? "ghost" : "outline"}>
        <Plus className="size-3.5" />
        Add
      </Button>
    </form>
  )
}
