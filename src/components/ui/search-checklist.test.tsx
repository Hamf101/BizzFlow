// @vitest-environment jsdom

import { act } from "react"
import { expect, it } from "vitest"

import { SearchChecklist } from "@/components/ui/search-checklist"
import { mount } from "@/test/render"

const PEOPLE = Array.from({ length: 8 }, (_, n) => ({ hint: n === 3 ? "Manager" : "Staff", label: `Person ${n + 1}`, value: `user-${n + 1}` }))

it("narrows a long list as you type, and still sends a ticked person the filter hid", async () => {
  const root = mount()
  await act(async () =>
    root.render(
      <form>
        <SearchChecklist defaultChecked={["user-2"]} label="Reviewers" name="reviewerIds" options={PEOPLE} />
      </form>
    )
  )
  const search = document.querySelector('input[type="search"]') as HTMLInputElement
  const type = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!

  await act(async () => {
    type.call(search, "manager")
    search.dispatchEvent(new Event("input", { bubbles: true }))
  })

  const shown = [...document.querySelectorAll("label")].filter((row) => !row.hidden).map((row) => row.textContent)
  expect(shown).toEqual(["Person 4Manager"])
  expect(new FormData(document.querySelector("form")!).getAll("reviewerIds")).toEqual(["user-2"])
})

it("shows no search box for a short list", async () => {
  const root = mount()
  await act(async () => root.render(<SearchChecklist label="Reviewers" name="reviewerIds" options={PEOPLE.slice(0, 4)} />))

  expect(document.querySelector('input[type="search"]')).toBeNull()
})
