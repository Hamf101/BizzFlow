// Kept apart from the template schemas, as template-limits is, so the signing
// page and the paper can tell whose a drawn box is without loading them.

import type { TemplateBlock } from "@/types/template"

/** Most signers one document is sent to. */
export const MAX_SIGNING_RECIPIENTS = 20

/** Who signs a signature or initials box. */
export type BoxSigner = "sender" | number

type DrawnBox = Extract<TemplateBlock, { type: "initials_field" | "signature_field" }>

/** The box's signer, Signer 1 when the template names none. */
export function boxSigner(block: { signer?: BoxSigner }): BoxSigner {
  return block.signer ?? 1
}

/**
 * What an empty drawn box says: that its signer has signed, or whose it is.
 *
 * @param block - A signature or initials box.
 * @param signers - Signers in the order they were added; none on a template.
 * @returns "Signer 2 signed", or "Sender signs here", "Signer 1 initials here".
 */
export function boxNote(block: DrawnBox, signers: ReadonlyArray<{ status: string }>): string {
  const signer = boxSigner(block)

  if (signer !== "sender" && signers[signer - 1]?.status === "signed") {
    return `Signer ${signer} signed`
  }

  return `${signer === "sender" ? "Sender" : `Signer ${signer}`} ${block.type === "signature_field" ? "signs" : "initials"} here`
}

/**
 * Answers with each drawn box holding only its own signer's mark: the sender's
 * stored drawing, or the drawing the k-th signer made when they signed.
 * Anything else stored under a drawn box is left out.
 *
 * @param blocks - The document's blocks.
 * @param answers - Stored answers.
 * @param signers - Signers in the order they were added.
 * @returns A copy of the answers to show or print.
 */
export function withBoxMarks(
  blocks: readonly TemplateBlock[],
  answers: Readonly<Record<string, unknown>>,
  signers: ReadonlyArray<{ id: string; initialsDataUrl?: string | null; signatureDataUrl?: string | null }>
): Record<string, unknown> {
  const marked: Record<string, unknown> = { ...answers }

  for (const block of blocks) {
    if (block.type !== "signature_field" && block.type !== "initials_field") {
      continue
    }

    const signer = boxSigner(block)
    const signerRecord = signer === "sender" ? undefined : signers[signer - 1]
    const mark =
      signer === "sender"
        ? answers[block.fieldKey]
        : block.type === "signature_field"
          ? signerRecord?.signatureDataUrl
          : signerRecord?.initialsDataUrl

    if (mark) {
      marked[block.fieldKey] = mark
    } else {
      delete marked[block.fieldKey]
    }
  }

  return marked
}

/**
 * Whose boxes the k-th person a link was sent to signs: Signer k's, or Signer
 * 1's when the document has no box for them, as when one form goes to several
 * people who each answer their own copy.
 *
 * @param blocks - What the link serves.
 * @param k - Their place in the send; 1 on a link for anyone.
 * @returns The signer whose boxes they draw.
 */
export function answeringSigner(blocks: readonly TemplateBlock[], k: number): number {
  return blocks.some((block) => (block.type === "signature_field" || block.type === "initials_field") && boxSigner(block) === k) ? k : 1
}

/**
 * Someone answering a link signs only their own boxes: every other drawn box
 * keeps what the sender stored in it, whatever was posted, and is not theirs
 * to complete.
 *
 * @param content - What the link serves.
 * @param values - What they posted.
 * @param stored - The answers the document was sent with.
 * @param k - Their place in the send, as answeringSigner reads it.
 * @returns The content to check the answers against, and the answers to keep.
 */
export function answeringAs<T extends { blocks: readonly TemplateBlock[] }>(
  content: T,
  values: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>,
  k: number
): { content: T; values: Record<string, unknown> } {
  const signer = answeringSigner(content.blocks, k)
  const kept: Record<string, unknown> = { ...values }
  const blocks = content.blocks.map((block) => {
    if ((block.type !== "signature_field" && block.type !== "initials_field") || boxSigner(block) === signer) {
      return block
    }

    delete kept[block.fieldKey]

    if (boxSigner(block) === "sender" && stored[block.fieldKey]) {
      kept[block.fieldKey] = stored[block.fieldKey]
    }

    return { ...block, required: false }
  })

  return { content: { ...content, blocks }, values: kept }
}
