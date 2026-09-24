import { createLucideIcon } from "lucide-react"

/**
 * Flow's mark: one line from the BizFlow mark, landing on a point. It stands
 * wherever Flow can be asked something, in place of a generic AI sparkle.
 */
export const FlowMark = createLucideIcon("flow-mark", [
  ["path", { d: "M3.5 14c2.4-3.1 4.85-3.1 7.25 0s4.6 3 6.6.1", key: "line" }],
  ["circle", { cx: "20.2", cy: "11.8", fill: "currentColor", key: "point", r: "2.1", stroke: "none" }],
])
