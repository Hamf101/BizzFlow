import { describe, expect, it } from "vitest"

import {
  createJpegBytes,
  toImageDataUrl,
} from "@/lib/image-header.test-support"
import {
  completePublicDocumentSigning,
  getPublicDocumentSigningView,
} from "@/services/document-signing-service"
import {
  createBaseTables,
  createRecipientRow,
  createTemplateContent,
  DRAWING_DATA_URL,
  FakeClient,
  NOW,
  RECIPIENT_ONE_ID,
  TOKEN_ONE,
} from "@/services/document-signing-service.test-support"

const SECOND_RECIPIENT_ID = "40000000-0000-4000-8000-000000000002"
const SECOND_TOKEN = "token_two_abcdefghijklmnopqrstuvwxyz123456"
const MALFORMED_DRAWING_DATA_URL = "data:image/png;base64,aGVsbG8="
const TINY_DRAWING_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

describe("document signing drawing and signature validation", () => {
  it("requires all required fields before the final signer can complete", async () => {
    const tables = createBaseTables()
    tables.document_signing_recipients.push(
      createRecipientRow(
        RECIPIENT_ONE_ID,
        TOKEN_ONE,
        "Avery Morgan",
        "avery@example.com"
      )
    )
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    const client = new FakeClient(tables)

    await expect(
      completePublicDocumentSigning(
        { consented: true,
          token: TOKEN_ONE,
          values: {},
          signatureDataUrl: DRAWING_DATA_URL,
        },
        { client: client as never, now: (): Date => NOW }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Client legal name must be completed before the final signature.",
    })
  })

  it("rejects malformed drawing bytes before recording a signature", async () => {
    const tables = createBaseTables()
    tables.document_signing_recipients.push(
      createRecipientRow(
        RECIPIENT_ONE_ID,
        TOKEN_ONE,
        "Avery Morgan",
        "avery@example.com"
      )
    )
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    const client = new FakeClient(tables)

    await expect(
      completePublicDocumentSigning(
        { consented: true,
          token: TOKEN_ONE,
          values: { client_name: "Northstar Labs" },
          signatureDataUrl: MALFORMED_DRAWING_DATA_URL,
        },
        { client: client as never, now: (): Date => NOW }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "The drawn signature is invalid.",
    })
    expect(tables.document_signing_recipients[0].status).toBe("pending")
    expect(tables.document_answers[0].workflow_status).toBe("awaiting_signatures")
  })

  it("rejects drawing images with implausibly small dimensions", async () => {
    const tables = createBaseTables()
    tables.document_signing_recipients.push(
      createRecipientRow(
        RECIPIENT_ONE_ID,
        TOKEN_ONE,
        "Avery Morgan",
        "avery@example.com"
      )
    )
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    const client = new FakeClient(tables)

    await expect(
      completePublicDocumentSigning(
        { consented: true,
          token: TOKEN_ONE,
          values: { client_name: "Northstar Labs" },
          signatureDataUrl: TINY_DRAWING_DATA_URL,
        },
        { client: client as never, now: (): Date => NOW }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "The drawn signature is invalid.",
    })
    expect(tables.document_signing_recipients[0].status).toBe("pending")
  })

  it("rejects a JPEG drawing that stops before its end marker", async () => {
    const tables = createBaseTables()
    tables.document_signing_recipients.push(
      createRecipientRow(
        RECIPIENT_ONE_ID,
        TOKEN_ONE,
        "Avery Morgan",
        "avery@example.com"
      )
    )
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    const client = new FakeClient(tables)

    await expect(
      completePublicDocumentSigning(
        { consented: true,
          token: TOKEN_ONE,
          values: { client_name: "Northstar Labs" },
          signatureDataUrl: toImageDataUrl(
            "jpeg",
            createJpegBytes(400, 200, { endMarker: false })
          ),
        },
        { client: client as never, now: (): Date => NOW }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "The drawn signature is invalid.",
    })
    expect(tables.document_signing_recipients[0].status).toBe("pending")
  })

  it("requires initials only from the signer whose required initials box it is, and stores them", async () => {
    const tables = createBaseTables()
    // The required initials box names no signer, so it is Signer 1's.
    tables.documents[0].template_snapshot = createTemplateContent({
      requiredInitials: true,
    })
    tables.document_signing_recipients.push(
      createRecipientRow(
        RECIPIENT_ONE_ID,
        TOKEN_ONE,
        "Avery Morgan",
        "avery@example.com"
      ),
      createRecipientRow(SECOND_RECIPIENT_ID, SECOND_TOKEN, "Jordan Lee", "jordan@example.com")
    )
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    const client = new FakeClient(tables)
    const deps = { client: client as never, now: (): Date => NOW }

    await expect(getPublicDocumentSigningView({ token: TOKEN_ONE }, deps)).resolves.toMatchObject({ requiresInitials: true })
    await expect(getPublicDocumentSigningView({ token: SECOND_TOKEN }, deps)).resolves.toMatchObject({ requiresInitials: false })

    // Signer 2 has no initials box, so signs without initials.
    await completePublicDocumentSigning(
      { consented: true, token: SECOND_TOKEN, values: { client_name: "Northstar Labs" }, signatureDataUrl: DRAWING_DATA_URL },
      deps
    )
    expect(tables.document_signing_recipients[1].status).toBe("signed")

    await expect(
      completePublicDocumentSigning(
        { consented: true,
          token: TOKEN_ONE,
          values: { client_name: "Northstar Labs" },
          signatureDataUrl: DRAWING_DATA_URL,
        },
        deps
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "A drawn initials acknowledgement is required.",
    })

    const completedView = await completePublicDocumentSigning(
      { consented: true,
        token: TOKEN_ONE,
        values: { client_name: "Northstar Labs" },
        signatureDataUrl: DRAWING_DATA_URL,
        initialsDataUrl: DRAWING_DATA_URL,
      },
      deps
    )

    expect(completedView.workflowStatus).toBe("completed")
    expect(tables.document_signing_recipients[0].initials_data).toEqual({
      dataUrl: DRAWING_DATA_URL,
    })
  })
})
