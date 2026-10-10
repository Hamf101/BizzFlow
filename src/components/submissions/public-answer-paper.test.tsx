// @vitest-environment jsdom
import { act } from "react"
import type { Root } from "react-dom/client"
import { beforeAll, expect, it } from "vitest"

import { parseGeneratedDocumentAnswers } from "@/components/documents/generated-document-form-data"
import { createEmptyDocumentContent, templateContentV3Schema } from "@/types/template"

import { PublicAnswerPaper } from "./public-answer-paper"
import { mount } from "@/test/render"

const NAME = "70000000-0000-4000-8000-000000000041"
const ACCOUNT = "70000000-0000-4000-8000-000000000042"
const NUMBER = "70000000-0000-4000-8000-000000000043"
const COLOUR = "70000000-0000-4000-8000-000000000044"

const CONTENT = templateContentV3Schema.parse({
  ...createEmptyDocumentContent(),
  blocks: [
    { fieldKey: "name", helpText: null, id: NAME, label: "Your name", multiline: false, placeholder: null, required: true, type: "text_field" },
    { checkedByDefault: false, fieldKey: "has_account", helpText: null, id: ACCOUNT, label: "I have an account", required: false, type: "checkbox_field" },
    {
      fieldKey: "account_number", helpText: null, id: NUMBER, label: "Account number", multiline: false, placeholder: null, required: true, type: "text_field",
      visibleWhen: { operator: "equals", sourceBlockId: ACCOUNT, value: true },
    },
    { display: "radios", fieldKey: "colour", helpText: null, id: COLOUR, label: "Colour", options: ["Red", "Blue"], placeholder: null, required: false, type: "dropdown_field" },
  ],
})

let root: Root
let form: HTMLFormElement

beforeAll(() => {
  window.matchMedia = () => ({ addEventListener() {}, matches: true, removeEventListener() {} }) as unknown as MediaQueryList
  globalThis.ResizeObserver = class { disconnect() {} observe() {} unobserve() {} } as unknown as typeof ResizeObserver
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
})

async function open(): Promise<void> {
  form = document.body.appendChild(document.createElement("form"))
  root = mount(form)
  await act(async () => root.render(<PublicAnswerPaper content={CONTENT} initialAnswers={{}} initialFiles={[]} phone title="Sign-up" token="t" />))
}

const field = (label: string) => form.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!

async function type(label: string, text: string): Promise<void> {
  const input = field(label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

it("posts its answers under the names the submit action reads", async () => {
  await open()
  await type("Your name", "Ana")
  await act(async () => field("I have an account").click())
  await type("Account number", "AC-7")
  await act(async () => form.querySelector<HTMLInputElement>('input[value="Blue"]')!.click())

  expect(parseGeneratedDocumentAnswers(new FormData(form))).toEqual({
    account_number: "AC-7",
    colour: "Blue",
    has_account: true,
    name: "Ana",
  })
})

it("holds back an unanswered required field with its reason under it, until it is answered", async () => {
  await open()

  expect(await act(async () => form.checkValidity())).toBe(false)
  const name = field("Your name")
  const reason = document.getElementById(name.getAttribute("aria-describedby") ?? "")
  expect(name.getAttribute("aria-invalid")).toBe("true")
  expect(reason?.getAttribute("role")).toBe("alert")
  expect(reason?.textContent).toBe("Your name is required.")
  expect(reason?.closest(`[data-block-id="${NAME}"]`)).not.toBeNull()

  await type("Your name", "Ana")
  expect(name.hasAttribute("aria-invalid")).toBe(false)
  expect(form.querySelector('[role="alert"]')).toBeNull()
  // The account number is required only once it shows.
  expect(form.checkValidity()).toBe(true)
  await act(async () => field("I have an account").click())
  expect(form.checkValidity()).toBe(false)
})

it("keeps what is typed in the moment the page takes over from the server's", async () => {
  form = document.body.appendChild(document.createElement("form"))
  // The page's form carries the link's token, which is how the paper finds its boxes.
  form.appendChild(Object.assign(document.createElement("input"), { name: "token", type: "hidden", value: "t" }))
  root = mount(form.appendChild(document.createElement("div")))
  // The page's code arrives with the boxes still blank, and someone types before its first tick is over.
  act(() => root.render(<PublicAnswerPaper content={CONTENT} initialAnswers={{}} initialFiles={[]} phone title="Sign-up" token="t" />))
  act(() => {
    const input = field("Your name")
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Ana")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))

  expect(field("Your name").value).toBe("Ana")
})

it("posts a drawing already in the document, so a box shown signed is sent signed", async () => {
  const drawn = "data:image/png;base64,AAAA"
  const content = templateContentV3Schema.parse({
    ...createEmptyDocumentContent(),
    blocks: [{ fieldKey: "sender_signature", helpText: null, id: NAME, label: "Signature", required: true, signer: "sender", type: "signature_field" }],
  })
  form = document.body.appendChild(document.createElement("form"))
  root = mount(form)
  await act(async () => root.render(<PublicAnswerPaper content={content} initialAnswers={{ sender_signature: drawn }} initialFiles={[]} phone title="Agreement" token="t" />))

  expect(form.checkValidity()).toBe(true)
  expect(parseGeneratedDocumentAnswers(new FormData(form))).toEqual({ sender_signature: drawn })
})
