import { expect, it } from "vitest"

import { readPersonChoice } from "@/components/people/person-search-field"

it("reads a person picked from the workspace, or anyone by their email, and nothing else", () => {
  expect(readPersonChoice("Jordan Ellis <jordan@example.com>")).toEqual({ email: "jordan@example.com", name: "Jordan Ellis" })
  // Someone outside the workspace goes by their address.
  expect(readPersonChoice("  sam@example.com ")).toEqual({ email: "sam@example.com", name: "sam@example.com" })
  expect(readPersonChoice("Jordan")).toBeNull()
  expect(readPersonChoice("Jordan <not an email>")).toBeNull()
  expect(readPersonChoice("")).toBeNull()
})
