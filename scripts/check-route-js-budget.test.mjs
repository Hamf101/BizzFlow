import { readFileSync } from "node:fs"
import { gzipSync } from "node:zlib"

import { describe, expect, it, vi } from "vitest"

import {
  assertRouteWithinBudget,
  calculateUniqueGzipBytes,
  collectClientChunks,
  parseClientReferenceManifest,
  resolveRouteManifestEntry,
} from "./check-route-js-budget.mjs"

const ROUTE_KEY = "/(dashboard)/documents/page"

function manifestSource(manifest) {
  return `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST[${JSON.stringify(ROUTE_KEY)}] = ${JSON.stringify(manifest)}`
}

describe("route JavaScript budget gate", () => {
  it("extracts the requested route manifest and rejects malformed input", () => {
    const manifest = {
      clientModules: {},
      entryJSFiles: { "[project]/src/app/page.tsx": ["static/chunks/page.js"] },
    }

    expect(parseClientReferenceManifest(manifestSource(manifest), ROUTE_KEY)).toEqual(
      manifest
    )
    expect(() => parseClientReferenceManifest("not a manifest", ROUTE_KEY)).toThrow(
      "Invalid client reference manifest"
    )
  })

  it("deduplicates shared JavaScript chunks across client and entry records", () => {
    const chunks = collectClientChunks({
      clientModules: {
        "[project]/src/components/one.tsx": {
          chunks: [
            "/_next/static/chunks/shared.js",
            "/_next/static/chunks/one.js",
          ],
        },
        "[project]/src/components/two.tsx": {
          chunks: [
            "/_next/static/chunks/shared.js",
            "/_next/static/css/not-javascript.css",
          ],
        },
      },
      entryJSFiles: {
        "[project]/src/app/layout.tsx": ["static/chunks/shared.js"],
        "[project]/src/app/page.tsx": ["static/chunks/page.js"],
      },
    })

    expect(chunks).toEqual([
      "static/chunks/shared.js",
      "static/chunks/one.js",
      "static/chunks/page.js",
    ])
  })

  it("rejects JavaScript chunk paths outside the generated chunk directory", () => {
    expect(() =>
      collectClientChunks({
        clientModules: {
          "[project]/src/components/unsafe.tsx": {
            chunks: ["/_next/../outside.js"],
          },
        },
        entryJSFiles: {},
      })
    ).toThrow("Invalid client chunk path")
  })

  it("gzip-compresses every unique chunk exactly once", () => {
    const contents = new Map([
      ["static/chunks/shared.js", Buffer.from("shared-code".repeat(80))],
      ["static/chunks/page.js", Buffer.from("page-code".repeat(120))],
    ])
    const readChunk = vi.fn((chunkPath) => contents.get(chunkPath))

    const total = calculateUniqueGzipBytes(
      [
        "static/chunks/shared.js",
        "static/chunks/page.js",
        "static/chunks/shared.js",
      ],
      readChunk
    )

    expect(total).toBe(
      gzipSync(contents.get("static/chunks/shared.js")).length +
        gzipSync(contents.get("static/chunks/page.js")).length
    )
    expect(readChunk).toHaveBeenCalledTimes(2)
  })

  it("reports the measured route and ceiling when a budget is exceeded", () => {
    expect(() =>
      assertRouteWithinBudget({
        label: "Core dashboard/list",
        route: ROUTE_KEY,
        measuredBytes: 251 * 1024,
        ceilingKiB: 250,
      })
    ).toThrow("Core dashboard/list")
    expect(() =>
      assertRouteWithinBudget({
        label: "Core dashboard/list",
        route: ROUTE_KEY,
        measuredBytes: 251 * 1024,
        ceilingKiB: 250,
      })
    ).toThrow("251.0 KiB exceeds 250 KiB")
  })

  it("fails closed when a representative route has no server entry", () => {
    expect(() => resolveRouteManifestEntry({}, ROUTE_KEY)).toThrow(
      `Missing representative route: ${ROUTE_KEY}`
    )
  })

  it("runs the budget gate immediately after the production build", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    )

    expect(packageJson.scripts["check:route-js"]).toBe(
      "node scripts/check-route-js-budget.mjs"
    )
    expect(packageJson.scripts.check).toContain(
      "pnpm build && pnpm check:route-js"
    )
  })
})
