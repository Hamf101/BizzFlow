import { expect, it } from "vitest"

import { readSignerPerson } from "@/components/pdf-signing/signer-person-field"

it("reads a person picked from the workspace, or anyone by their email, and nothing else", () => {
  expect(readSignerPerson("Jordan Ellis <jordan@example.com>")).toEqual({ email: "jordan@example.com", name: "Jordan Ellis" })
  // Someone outside the workspace goes by their address.
  expect(readSignerPerson("  sam@example.com ")).toEqual({ email: "sam@example.com", name: "sam@example.com" })
  expect(readSignerPerson("Jordan")).toBeNull()
  expect(readSignerPerson("Jordan <not an email>")).toBeNull()
  expect(readSignerPerson("")).toBeNull()
})
