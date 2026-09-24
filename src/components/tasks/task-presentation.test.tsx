import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { TaskPageShell } from "./task-presentation"

describe("TaskPageShell", () => {
  it("renders page content without reflecting editable action copy", () => {
    const html = renderToStaticMarkup(
      // @ts-expect-error Legacy raw feedback is intentionally unsupported.
      <TaskPageShell feedback={{ error: "private provider detail" }}>
        <h1>Tasks</h1>
      </TaskPageShell>
    )

    expect(html).toContain("Tasks")
    expect(html).not.toContain("private provider detail")
  })
})
