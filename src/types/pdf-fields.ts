import { z } from "zod"

/** What a signer can be asked for on an uploaded PDF. */
export const PDF_FIELD_KINDS = ["signature", "initials", "date", "text", "checkbox", "attachment"] as const

/** One kind of field. */
export type PdfFieldKind = (typeof PDF_FIELD_KINDS)[number]

const fraction = z.number().finite().min(0).max(1)

/** Someone who signs, by role, before anyone is invited: "Tenant", "Landlord". */
export const pdfSignerSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
  })
  .strict()

/**
 * A field on one page, where it was placed on the page as shown: fractions of
 * its width and height from its top left, so zoom, screen and page size never
 * move it.
 */
export const pdfFieldSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(PDF_FIELD_KINDS),
    page: z.number().int().min(1).max(2_000),
    x: fraction,
    y: fraction,
    width: z.number().finite().min(0.01).max(1),
    height: z.number().finite().min(0.005).max(1),
    signerId: z.string().uuid(),
    label: z.string().trim().min(1).max(80).nullable().default(null),
    required: z.boolean().default(true),
    /** Words' size in points, for text and dates; left to fit the field when unset. */
    fontSize: z.number().finite().min(6).max(28).nullable().default(null),
  })
  .strict()
  .refine((field) => field.x + field.width <= 1.000_1 && field.y + field.height <= 1.000_1, "A field must stay on its page.")

/** Who signs a PDF, and the fields each of them fills. */
export const pdfFieldLayoutSchema = z
  .object({
    signers: z.array(pdfSignerSchema).min(1).max(10),
    fields: z.array(pdfFieldSchema).max(500),
  })
  .strict()
  .superRefine((layout, context) => {
    const signers = new Set(layout.signers.map((signer) => signer.id))
    const names = new Set(layout.signers.map((signer) => signer.name.toLowerCase()))
    const fields = new Set(layout.fields.map((field) => field.id))

    if (signers.size !== layout.signers.length || names.size !== layout.signers.length) {
      context.addIssue({ code: "custom", message: "Give each signer a different name.", path: ["signers"] })
    }

    if (fields.size !== layout.fields.length) {
      context.addIssue({ code: "custom", message: "Each field must be different.", path: ["fields"] })
    }

    layout.fields.forEach((field, index) => {
      if (!signers.has(field.signerId)) {
        context.addIssue({ code: "custom", message: "Every field needs someone to fill it.", path: ["fields", index, "signerId"] })
      }
    })
  })

/** One field. */
export type PdfField = z.infer<typeof pdfFieldSchema>


/** A PDF's signers and fields. */
export type PdfFieldLayout = z.infer<typeof pdfFieldLayoutSchema>
