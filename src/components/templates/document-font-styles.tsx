import type { ReactElement } from "react"

/**
 * Loads the stylesheets of the font families some text uses, and of the
 * default family that prints any character those families lack. React puts
 * each stylesheet in the page's head once, however many lines ask for it.
 *
 * @param props - The families, as runs name them; blanks are skipped.
 * @returns The stylesheet links.
 */
export function DocumentFontStyles({ fonts }: { fonts: ReadonlyArray<string | undefined> }): ReactElement | null {
  const families = [...new Set(fonts.filter(Boolean))]

  if (families.length === 0) {
    return null
  }

  return (
    <>
      {["default", ...families].map((family) => (
        // Given a precedence, React puts the stylesheet in the head, once.
        <link href={`/fonts/${family}/font.css`} key={family} precedence="document-fonts" rel="stylesheet" />
      ))}
    </>
  )
}

/**
 * The CSS font stack for a family: its own faces, then the default family
 * for any character it lacks, as the PDF prints them.
 *
 * @param font - The family, as runs name it.
 * @returns The value for font-family.
 */
export function documentFontFamily(font: string): string {
  return `"bf-${font}", "bf-default", sans-serif`
}
