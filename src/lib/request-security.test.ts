import { afterEach, describe, expect, it } from "vitest"

import {
  readTrustedJsonObject,
  RequestSecurityError,
} from "./request-security"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("trusted JSON request validation", () => {
  it("accepts same-origin JSON requests", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com"

    await expect(
      readTrustedJsonObject(
        createRequest({ origin: "https://app.example.com" })
      )
    ).resolves.toEqual({ organizationId: "org-1" })
  })

  it("rejects cross-origin browser requests", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com"

    await expect(
      readTrustedJsonObject(
        createRequest({ origin: "https://attacker.example.net" })
      )
    ).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<RequestSecurityError>)
  })

  it("rejects requests declared cross-site by Fetch Metadata", async () => {
    await expect(
      readTrustedJsonObject(createRequest({ "sec-fetch-site": "cross-site" }))
    ).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<RequestSecurityError>)
  })

  it("rejects JSON bodies sent with a simple text content type", async () => {
    const request = new Request("https://app.example.com/api/test", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ organizationId: "org-1" }),
    })

    await expect(readTrustedJsonObject(request)).rejects.toMatchObject({
      statusCode: 415,
    } satisfies Partial<RequestSecurityError>)
  })

  it("rejects arrays and malformed JSON", async () => {
    await expect(
      readTrustedJsonObject(createRequest({}, JSON.stringify([])))
    ).rejects.toMatchObject({ statusCode: 400 })

    await expect(
      readTrustedJsonObject(createRequest({}, "{"))
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

function createRequest(
  headers: Record<string, string> = {},
  body = JSON.stringify({ organizationId: "org-1" })
): Request {
  return new Request("https://app.example.com/api/test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
  })
}
