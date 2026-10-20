import { describe, expect, it } from "vitest"

import { describeMove } from "@/components/people/org-chart"
import type { OrganizationStructure } from "@/services/organization-service"
import type { OrganizationMember } from "@/types/organization"

const member = (userId: string, roleDefinitionId: string): OrganizationMember => ({
  createdAt: "2026-10-19T00:00:00Z",
  email: `${userId}@example.test`,
  fullName: userId,
  id: `m-${userId}`,
  role: "staff",
  roleDefinitionId,
  status: "active",
  userId,
})
const members = [member("Ash", "staff"), member("Avery", "staff"), member("Blair", "staff"), member("Lee", "manager"), member("Kim", "everyone")]
const structure: OrganizationStructure = {
  managers: { Ash: "Lee" },
  roles: [
    { id: "staff", name: "Staff", scope: "branch", setByOwner: false, systemKey: "staff" },
    { id: "manager", name: "Manager", scope: "everyone", setByOwner: false, systemKey: "manager" },
    { id: "everyone", name: "Driver", scope: "everyone", setByOwner: true, systemKey: null },
  ],
  units: [
    { id: "crew1", members: [{ isLead: false, userId: "Ash" }, { isLead: false, userId: "Avery" }, { isLead: false, userId: "Lee" }], name: "Crew 1", parentId: null },
    { id: "crew2", members: [{ isLead: false, userId: "Blair" }], name: "Crew 2", parentId: null },
  ],
}
const name = (userId: string): string => userId

describe("describeMove", () => {
  it("names whom a move stops and starts showing, and keeps the manager out of both", () => {
    expect(describeMove({ from: "crew1", to: "crew2", userId: "Ash" }, structure, members, name)).toBe(
      "Move Ash to Crew 2? Ash stops seeing Avery, and starts seeing Blair. Lee still manages Ash and sees what they submit."
    )
  })

  it("says only the team changes for a role that sees everyone", () => {
    expect(describeMove({ from: null, to: "crew2", userId: "Kim" }, structure, members, name)).toBe(
      "Move Kim to Crew 2? Kim's role sees everyone, so only their team changes."
    )
  })

  it("warns that placing someone narrows them to their team", () => {
    expect(describeMove({ from: null, to: "crew2", userId: "Avery" }, structure, members, name)).toBe(
      "Move Avery to Crew 2? Once in a team, Avery sees only their teams and reporting line: Blair."
    )
  })

  it("says nothing changes when the new team holds the same people", () => {
    const same = { ...structure, units: [...structure.units, { id: "crew3", members: [{ isLead: false, userId: "Avery" }], name: "Crew 3", parentId: null }] }
    expect(describeMove({ from: "crew1", to: "crew3", userId: "Ash" }, same, members, name)).toBe(
      "Move Ash to Crew 3? Who Ash sees stays the same. Lee still manages Ash and sees what they submit."
    )
  })
})
