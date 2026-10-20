"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { type ReactElement, useTransition } from "react"

import type { StructureChange } from "@/app/(dashboard)/settings/actions"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { bizflowToast } from "@/components/ui/toaster"
import type { OrganizationStructure } from "@/services/organization-service"

const REACH_LABELS = {
  everyone: "Everyone",
  branch: "Their teams and reporting line",
  inviter: "Their inviter's side",
} as const

/**
 * How far each role sees. Where people sit, the teams and reporting lines,
 * is arranged on the People page's chart; this is the rule that reads it.
 *
 * @param props - Each role's reach, and the action that saves a change.
 * @returns The reach card.
 */
export function TeamsSettings({
  change,
  structure,
}: {
  change: (input: StructureChange) => Promise<{ error?: string }>
  structure: OrganizationStructure
}): ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

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

  return (
    <Card aria-busy={pending}>
      <CardHeader>
        <CardTitle>What each role sees</CardTitle>
        <CardDescription>
          Someone sees as far as their role reaches from where they sit.{" "}
          <Link className="text-primary underline-offset-4 hover:underline" href="/people?view=teams">
            Arrange teams and reporting lines
          </Link>
          . Anyone not yet in a team still sees everyone.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
      </CardContent>
    </Card>
  )
}
