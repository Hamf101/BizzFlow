import type { Locator, Page } from "@playwright/test"

// Installed in every document the page opens, so a caption survives navigation
// until the next one replaces it.
function installCaption(): void {
  const show = (text: string): void => {
    let box = document.getElementById("demo-caption")
    if (!box) {
      box = document.createElement("div")
      box.id = "demo-caption"
      box.setAttribute("aria-hidden", "true")
      Object.assign(box.style, {
        background: "rgba(17, 17, 17, 0.86)",
        borderRadius: "14px",
        bottom: "40px",
        color: "#fff",
        font: "600 26px/1.35 system-ui, sans-serif",
        left: "50%",
        maxWidth: "min(80vw, 900px)",
        padding: "16px 28px",
        pointerEvents: "none",
        position: "fixed",
        textAlign: "center",
        transform: "translateX(-50%)",
        transition: "opacity 400ms ease",
        zIndex: "2147483647",
      })
      document.documentElement.append(box)
    }
    box.textContent = text
    box.style.opacity = text ? "1" : "0"
    sessionStorage.setItem("demo-caption", text)
  }
  const restore = (): void => show(sessionStorage.getItem("demo-caption") ?? "")

  Object.assign(window, { __demoCaption: show })
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", restore)
  else restore()
}

const installed = new WeakSet<Page>()

/**
 * Shows a caption at the bottom centre, fading in over the last one; an empty
 * string fades it out. It stays across page loads until replaced.
 */
export async function caption(page: Page, text: string): Promise<void> {
  if (!installed.has(page)) {
    installed.add(page)
    await page.addInitScript(installCaption)
    await page.evaluate(installCaption)
  }
  await page.evaluate((next) => (window as unknown as { __demoCaption: (text: string) => void }).__demoCaption(next), text)
  await beat(page, 1_800)
}

/** Holds still so a viewer can read what just happened. */
export function beat(page: Page, ms = 1_200): Promise<void> {
  return page.waitForTimeout(ms)
}

/** Types at a person's pace rather than pasting. */
export function typeLikeAPerson(locator: Locator, text: string): Promise<void> {
  return locator.pressSequentially(text, { delay: 40 })
}
