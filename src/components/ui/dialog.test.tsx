// @vitest-environment jsdom

import type { ReactElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { Button } from "./button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog"

const mountedRoots: Root[] = []

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
})

function render(ui: ReactElement): void {
  const container = document.createElement("div")
  document.body.append(container)

  const root = createRoot(container)
  mountedRoots.push(root)
  act(() => root.render(ui))
}

function getButton(name: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name
  )

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected a button named "${name}".`)
  }

  return button
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

function ConfirmationDialog({
  onDelete = vi.fn(),
}: {
  onDelete?: () => void
}): ReactElement {
  return (
    <Dialog>
      <DialogTrigger>Open trash confirmation</DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Move “Quarterly report” to Trash?</DialogTitle>
          <DialogDescription>
            You can restore it until permanent deletion.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={onDelete}>
            Move to Trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

describe("Dialog", () => {
  it("labels the modal, describes its consequence, and moves focus inside", async () => {
    render(<ConfirmationDialog />)

    await click(getButton("Open trash confirmation"))

    const dialog = document.querySelector('[role="dialog"]')
    const title = document.getElementById(
      dialog?.getAttribute("aria-labelledby") ?? ""
    )
    const description = document.getElementById(
      dialog?.getAttribute("aria-describedby") ?? ""
    )

    expect(dialog).not.toBeNull()
    expect(title?.textContent).toBe("Move “Quarterly report” to Trash?")
    expect(description?.textContent).toBe(
      "You can restore it until permanent deletion."
    )
    expect(document.activeElement).toBe(getButton("Cancel"))
    expect(getButton("Move to Trash").className).toContain("text-destructive")
  })

  it("closes safely with Cancel or Escape and returns focus to the trigger", async () => {
    const onDelete = vi.fn()
    render(<ConfirmationDialog onDelete={onDelete} />)

    const trigger = getButton("Open trash confirmation")
    await click(trigger)
    await click(getButton("Cancel"))

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(onDelete).not.toHaveBeenCalled()

    await click(trigger)
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
      )
    })

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(onDelete).not.toHaveBeenCalled()
  })
})
