// @vitest-environment jsdom
import { act } from "react"
import { expect, it, vi } from "vitest"

import { mount } from "@/test/render"

import { OneClickForm } from "./one-click-form"

it("makes one, not two, when a second press lands before the button can grey out, and is ready again after", async () => {
  let finish = (): void => undefined
  const action = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
  const root = mount()
  await act(async () => root.render(<OneClickForm action={action}>New document</OneClickForm>))
  const form = document.querySelector("form")!

  // Both in the same frame: no render between them.
  await act(async () => {
    form.requestSubmit()
    form.requestSubmit()
  })
  expect(action).toHaveBeenCalledTimes(1)

  // Once it has finished (a refusal brings the page back), it works again.
  await act(async () => finish())
  await act(async () => form.requestSubmit())
  expect(action).toHaveBeenCalledTimes(2)
  root.unmount()
})
