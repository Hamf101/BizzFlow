// @vitest-environment jsdom
import { act } from "react"
import { expect, it } from "vitest"

import { mount } from "@/test/render"

import { SubmitOnChangeSwitch } from "./submit-on-change-switch"

it("saves a setting the moment it is switched, sending what it now says", async () => {
  const sent: Array<string | null> = []
  const root = mount()

  await act(async () =>
    root.render(
      <form
        onSubmit={(event) => {
          event.preventDefault()
          sent.push(new FormData(event.currentTarget).get("emailNotificationsEnabled") as string | null)
        }}
      >
        <SubmitOnChangeSwitch aria-label="Email" defaultChecked={false} name="emailNotificationsEnabled" />
      </form>
    )
  )
  const toggle = document.querySelector<HTMLElement>('[role="switch"]')!

  await act(async () => toggle.click())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(sent).toEqual(["on"])

  // Off sends nothing for it, which the action reads as off.
  await act(async () => toggle.click())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(sent).toEqual(["on", null])
  root.unmount()
})
