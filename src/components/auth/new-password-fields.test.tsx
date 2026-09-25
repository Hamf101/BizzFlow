// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, expect, it } from "vitest"

import { NewPasswordFields } from "./new-password-fields"

let root: Root | null = null

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
})

// React hears typing through the input's native value setter and an input event.
async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

it("holds the form until the password meets every rule and both match", async () => {
  const container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
  await act(async () =>
    root!.render(
      <form>
        <NewPasswordFields />
      </form>
    )
  )
  const form = document.querySelector("form")!
  const password = document.querySelector<HTMLInputElement>('input[name="password"]')!
  const confirm = document.querySelector<HTMLInputElement>('input[name="confirm"]')!

  await type(password, "weakpassword")
  await type(confirm, "weakpassword")
  expect(form.checkValidity()).toBe(false)

  await type(password, "Pl@nted-4-trees")
  expect(form.checkValidity()).toBe(false)
  expect(document.body.textContent).toContain("The passwords don't match.")

  await type(confirm, "Pl@nted-4-trees")
  expect(form.checkValidity()).toBe(true)
  expect(document.body.textContent).not.toContain("The passwords don't match.")
})
