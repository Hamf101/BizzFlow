import type { InngestFunction } from "inngest"

/**
 * Every background function served at the Inngest endpoint.
 *
 * The serve handler registers exactly this list, so a function is only live
 * once it appears here.
 */
export const inngestFunctions: InngestFunction.Any[] = []
