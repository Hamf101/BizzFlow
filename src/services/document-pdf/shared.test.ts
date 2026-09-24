import { describe, expect, it } from "vitest"

import { formatFieldValue } from "./shared"
import type { PdfFieldBlock } from "./types"

describe("printed answers", () => {
  it("prints a date the way its field asks", () => {
    const block = {
      dateFormat: { month: "long", order: "dmy", separator: " " },
      fieldKey: "move_in",
      helpText: null,
      id: "00000000-0000-4000-8000-000000000001",
      label: "Move-in date",
      required: true,
      type: "date_field",
    } as PdfFieldBlock

    expect(formatFieldValue(block, "2026-09-02")).toBe("2 September 2026")
    expect(formatFieldValue({ ...block, dateFormat: undefined } as PdfFieldBlock, "2026-09-02")).toBe("2026-09-02")
  })
})
