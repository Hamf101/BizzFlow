import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { renderGeneratedDocumentPdf } from "../src/services/document-pdf-service"
import {
  createBlankTemplateContent,
  type ParagraphBlock,
  type TemplateContent
} from "../src/types/template"

const SAMPLE_SIGNATURE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAABGCAYAAADyxhn6AAADkUlEQVR42u2dy23cMBBAV4SLSBkB0kaQSnx1FbmmkkXaWCBlbBfKaQHD0IdDcn7UexfDB0sUyafhkBS9rOt6A4CcFKoAAIEBAIEBAIEBEBgAEBgAEBgAEBgAgQEAgQEAgQEQGAAQGAAQGAAQGACBAQCBM/Dtx6/16HeAaLxRBccSAxCBE4uL0HApgRmGAiQfQmeTlpcMEIEnHoYiOJADJ5Lz+bgvdA1SpEsJPEtDIu95G+/9hIkjcMRGlpTp6p30LPIicWKBvzbe83FfMkayz2UmEiMnEXiyTklHPk41qJ+EAm9F34xRYKvcRGH5JF8kia+Qo5cMQ7GthuhpFCLFmHraEzlC/W5NtM3Y7kUz+mpEsM8NMapBJOW8ivx7z1nbxl71dCbqbO1XrjaBIr2e9zDaYxhYK280iWvvN1M0Lta57+ilm96GiJrnbo00LDqdVN4I9dgq5Awil2wbI3quN6qxtBvdawjYKq/nzPTR9V/LmWflzyxxiTrzLJn9bG2Ano7pGUk0OlyvvB6CnMkr2ZuQNRqXiHlt6+xn5respDNadbiWerbIh4+e/UzU2UQuFtF3xFt89DCot0wjh+M18mqKMfqDDuuytpR5lmF1ybpxwHrpxypNOIoUe9Ej4pr46PqqfdFJyxg5Gtfcu3jlvpZ5XMSloZ7OOEpizbzXopyj9t1HEvl1r9r7lUif6UmHcq3XjLqfWtIZe+XQltdivVZjhcND5CNpz+5Xosw8j8rDNCbARo04NIaAI9fONeRtzYe1o653fiyNtCFzYO3c1HPjg0Tc0S+VlnVkDyFajmCySn80orFE2to17GVdV9fc9/m4L73Rd+/vtUYNtde17Ig1deg5bK65fwRxPT/saHnGMsNe52jfplrnbj1rxZZitI6WImx3lQyrNSJtcwQeHcVqHypS7iuJdt4dUfuNf5UyZtl//zbLoXJ7Q3GtMkrPhLLM3Wb4bC7yYQotdaz1PMV65tmjYTw7g9f5YJG/HopcttHPod3+Zaa3brSG9y6P9Ptd77JlPAzxa5ktpK0S2Oqsq6znT/VsmPco59meau/On/38Ma82r15G0l72GD3J9MpTNSuV/+oA3lQJrNX5LSSzfBa6E1xGYADgYHcABAYABAYABAaAm/VWyu/vv/9SnQD1/Pvz8ZMIDHBjGQkAyIEBAIEBAIEBEBgAEBgAEBgAEBgAgQEAgQEAgQEQGAAy8R9lN2cGgBeCXgAAAABJRU5ErkJggg=="
const SAMPLE_INITIALS_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFoAAABGCAYAAABMvIPiAAABxUlEQVR42u2c7W3DMAxE60N2aOdo52iHzR7ZI1uovwwEQapaH6Qo+REQggSJdXw6i5JtZEspvRH2IRAAGtAEoAENaALQgCYADWhAE4AGNAHoM4D++PpJufeA7gx7b9GSHWmEi1USj5/fb9ctKmzmaCfAXuAphjM5OnrRi6BPZ0l0tD4T0JGKn4e+IwN1wa39+3k1kPJyS23CvUGNcLPpHN0zIY9NUK9j/5W3Ip+Wrcd//v0jBO86opmKYLQiW2IErbqeremrVV/OCLJMpMWBHkXQU5+YNnz0acV1bUsfVvpkLabGiZ5rZy99Wm3aGLFTPaJv+cukUeZ29dwEHE0257oIjrTQp5UcGXXaKAY9213tSEtCjUrk1aBFWpYd0VeSvyK7q2UgS39r7X6tcqUu+kZLI+e/nPgIRbCXPvdVh1dxqu3HUp+YNnz0abUtt8c9wZo+xMMtPibSzHehZ9pAaaUL/B7FtrYPHnKM4GirU9N6DW6lr0W3mDZ4EH2Zq4hZ0DMlE93NRY6OlMz9dt32Zj14z6/VkVL6t71/fqcj3ytt+3Gtjh+pbfwdG8UQ0ASgAQ1oAtCAJgANaEATgAY0AWhAnzt+AYVWKO/IU0UDAAAAAElFTkSuQmCC"

/**
 * Renders a multi-page generated document for visual PDF regression checks.
 *
 * @returns Resolves after writing the requested sample PDF.
 */
async function main(): Promise<void> {
  const requestedPath =
    process.argv[2] ?? "artifacts/verification/generated-document-sample.pdf"
  const outputPath = resolve(process.cwd(), requestedPath)
  const content = createSampleContent()
  const pdf = await renderGeneratedDocumentPdf({
    documentId: "visual-verification-sample",
    title: "Professional services agreement",
    content,
    answers: {
      client_name: "Northstar Labs LLC",
      effective_date: "2026-07-17",
      engagement_type: "Fixed fee",
      terms_accepted: true
    },
    workflowStatus: "completed",
    signers: [
      {
        id: "signer-1",
        name: "Avery Morgan",
        email: "avery@example.com",
        requiresSignature: true,
        status: "signed",
        signedAt: "2026-07-17T18:30:00.000Z",
        signatureDataUrl: SAMPLE_SIGNATURE_DATA_URL,
        initialsDataUrl: SAMPLE_INITIALS_DATA_URL
      },
      {
        id: "signer-2",
        name: "Jordan Lee",
        email: "jordan@example.com",
        requiresSignature: true,
        status: "signed",
        signedAt: "2026-07-17T19:10:00.000Z",
        signatureDataUrl: SAMPLE_SIGNATURE_DATA_URL,
        initialsDataUrl: SAMPLE_INITIALS_DATA_URL
      }
    ]
  })

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, pdf)
  console.info("generated_document_visual_sample_written", {
    outputPath,
    byteSize: pdf.length
  })
}

function createSampleContent(): TemplateContent {
  const content = createBlankTemplateContent()
  const detailParagraphs: ParagraphBlock[] = Array.from(
    { length: 18 },
    (_value: unknown, index: number): ParagraphBlock => ({
      id: `00000000-0000-4000-8${String(index).padStart(3, "0")}-000000000100`,
      type: "paragraph",
      text: `Service detail ${index + 1}. BizFlow Studio will coordinate the agreed discovery, implementation, review, and handoff activities with the client team. Each milestone will be confirmed in writing before the next phase begins.`,
      alignment: "left"
    })
  )

  return {
    ...content,
    branding: {
      ...content.branding,
      organizationName: "BizFlow Studio",
      primaryColor: "#17324D",
      accentColor: "#2F6B8A"
    },
    blocks: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        type: "paragraph",
        text: "CONFIDENTIAL - CLIENT AGREEMENT",
        alignment: "right"
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        type: "heading",
        text: "Engagement overview",
        level: 2,
        alignment: "left"
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        type: "paragraph",
        text: "This agreement records the services, commercial terms, and acknowledgements accepted by both parties.",
        alignment: "left"
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        type: "bullet_list",
        items: [
          "Discovery and requirements workshop",
          "Structured implementation and weekly review",
          "Final handoff and supporting documentation"
        ]
      },
      {
        id: "00000000-0000-4000-8000-000000000005",
        type: "table",
        headers: ["Phase", "Target", "Amount"],
        rows: [
          ["Discovery", "Week 1", "$1,500"],
          ["Implementation", "Weeks 2-4", "$4,500"],
          ["Handoff", "Week 5", "$1,000"]
        ]
      },
      {
        id: "00000000-0000-4000-8000-000000000006",
        type: "text_field",
        fieldKey: "client_name",
        label: "Client legal name",
        required: true,
        helpText: "Use the registered business name.",
        placeholder: null,
        multiline: false
      },
      {
        id: "00000000-0000-4000-8000-000000000007",
        type: "date_field",
        fieldKey: "effective_date",
        label: "Effective date",
        required: true,
        helpText: null
      },
      {
        id: "00000000-0000-4000-8000-000000000008",
        type: "dropdown_field",
        fieldKey: "engagement_type",
        label: "Engagement type",
        required: true,
        helpText: null,
        placeholder: null,
        options: ["Fixed fee", "Time and materials"]
      },
      {
        id: "00000000-0000-4000-8000-000000000009",
        type: "checkbox_field",
        fieldKey: "terms_accepted",
        label: "Commercial terms accepted",
        required: true,
        helpText: null,
        checkedByDefault: false
      },
      {
        id: "00000000-0000-4000-8000-000000000010",
        type: "divider"
      },
      {
        id: "00000000-0000-4000-8000-000000000011",
        type: "heading",
        text: "Detailed service terms",
        level: 2,
        alignment: "left"
      },
      ...detailParagraphs,
      {
        id: "00000000-0000-4000-8000-000000000012",
        type: "paragraph",
        text: "BizFlow Studio - BF-2026-0717",
        alignment: "center"
      }
    ]
  }
}

void main().catch((error: unknown): void => {
  console.error("generated_document_visual_sample_failed", {
    reason: error instanceof Error ? error.message : "Unknown sample error"
  })
  process.exitCode = 1
})
