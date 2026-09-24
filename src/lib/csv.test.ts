import { describe, expect, it } from "vitest"

import {
  buildCsvExportFilename,
  createCsvDownloadResponse,
  escapeCsvField,
  formatCsv,
} from "@/lib/csv"

describe("escapeCsvField", () => {
  it("quotes every value and doubles embedded quotes", () => {
    expect(escapeCsvField("plain")).toBe('"plain"')
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvField("a,b")).toBe('"a,b"')
    expect(escapeCsvField("line\nbreak")).toBe('"line\nbreak"')
  })

  it("renders empty strings for absent values and JSON for objects", () => {
    expect(escapeCsvField(null)).toBe('""')
    expect(escapeCsvField(undefined)).toBe('""')
    expect(escapeCsvField(0)).toBe('"0"')
    expect(escapeCsvField(false)).toBe('"false"')
    expect(escapeCsvField({ revision: 2 })).toBe('"{""revision"":2}"')
  })
})

describe("escapeCsvField formula neutralization", () => {
  it("leaves risky values alone by default", () => {
    expect(escapeCsvField("=1+1")).toBe('"=1+1"')
    expect(escapeCsvField("-500")).toBe('"-500"')
  })

  it.each(["=cmd|'/c calc'!A1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1"])(
    "prefixes %j with an apostrophe when asked",
    (value) => {
      expect(escapeCsvField(value, true)).toBe(`"'${value}"`)
    }
  )

  it("does not touch a value that merely contains a trigger", () => {
    expect(escapeCsvField("Q1 = up", true)).toBe('"Q1 = up"')
  })
})

describe("formatCsv", () => {
  it("escapes the header row as well as the body", () => {
    const csv = formatCsv(["Log ID", "Details"], [["log-1", { count: 1 }]])

    expect(csv).toBe('"Log ID","Details"\n"log-1","{""count"":1}"')
  })

  it("emits a header-only document when there are no rows", () => {
    expect(formatCsv(["Only"], [])).toBe('"Only"')
  })

  it("neutralizes only the body, never the headers we control", () => {
    const csv = formatCsv(["=Header"], [["=danger"]], true)

    expect(csv).toBe('"=Header"\n"\'=danger"')
  })
})

describe("buildCsvExportFilename", () => {
  it("dates the file and exposes only the organization id prefix", () => {
    const filename = buildCsvExportFilename(
      "audit-log",
      "10000000-0000-4000-8000-000000000001",
      new Date("2026-08-17T09:30:00.000Z")
    )

    expect(filename).toBe("bizflow-audit-log-10000000-2026-08-17.csv")
  })
})

describe("createCsvDownloadResponse", () => {
  it("returns an uncached csv attachment", async () => {
    const response = createCsvDownloadResponse('"a"', "export.csv")

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="export.csv"'
    )
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    await expect(response.text()).resolves.toBe('"a"')
  })
})
