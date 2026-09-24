import { getAppUrlEnv, getEmailEnv } from "@/lib/env"
import {
  EmailTransportError,
  type EmailPayload,
  type EmailTransport,
} from "@/services/email/contracts"
import { escapeHtml, wrapEmailDocument } from "@/services/email/html"
import { sendEmail } from "@/services/email/transport"
import { TaskServiceError } from "@/services/tasks/errors"

/** Reason a task notification email is being sent. */
export type TaskEmailKind = "assigned" | "reminder"

/** Content and routing details for one task notification email. */
export type SendTaskEmailInput = {
  kind: TaskEmailKind
  deliveryReference: string
  taskId: string
  taskTitle: string
  dueAt: string | null
  recipientEmail: string
  recipientName: string | null
}

/** Optional transport dependency accepted by the task email sender. */
export type TaskEmailDeps = {
  transport?: EmailTransport
}

const TASK_EMAIL_COPY: Readonly<
  Record<TaskEmailKind, { subjectPrefix: string; heading: string; intro: string }>
> = {
  assigned: {
    subjectPrefix: "New task assigned",
    heading: "A task was assigned to you",
    intro: "You are now responsible for this task.",
  },
  reminder: {
    subjectPrefix: "Task reminder",
    heading: "Reminder for your task",
    intro: "This is the reminder you scheduled for this task.",
  },
}

const dueAtFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
})

/**
 * Sends one task notification through the shared transactional transport.
 *
 * EmailJS receives the delivery reference as provider-visible trace metadata
 * but does not offer an equivalent idempotency-key guarantee.
 *
 * @param input - Notification kind, task summary, and recipient details.
 * @param deps - Optional transport dependency for tests.
 * @returns Resolves once the provider accepts the delivery request.
 * @throws TaskServiceError when email configuration or delivery fails.
 */
export async function sendTaskEmail(
  input: SendTaskEmailInput,
  deps: TaskEmailDeps = {}
): Promise<void> {
  const startedAt = Date.now()
  let emailEnv: ReturnType<typeof getEmailEnv>
  let taskUrl: string

  try {
    emailEnv = getEmailEnv()
    taskUrl = new URL(
      `/tasks/${encodeURIComponent(input.taskId)}`,
      getAppUrlEnv().NEXT_PUBLIC_APP_URL
    ).toString()
  } catch {
    console.error("task_email_configuration_failed", {
      kind: input.kind,
      taskId: input.taskId,
      durationMs: Date.now() - startedAt,
      failureKind: "invalid_configuration",
    })
    throw new TaskServiceError(
      "Task email is not configured. Add the required email provider environment variables.",
      500
    )
  }

  const copy = TASK_EMAIL_COPY[input.kind]
  const subject = `${copy.subjectPrefix}: ${input.taskTitle}`
  const payload: EmailPayload = {
    toEmail: input.recipientEmail,
    subject,
    html: wrapEmailDocument({
      subject,
      contentHtml: createTaskEmailHtml(input, taskUrl),
    }),
    text: createTaskEmailText(input, taskUrl),
    ...(emailEnv.EMAIL_REPLY_TO_EMAIL
      ? { replyTo: emailEnv.EMAIL_REPLY_TO_EMAIL }
      : {}),
  }

  try {
    const transport = deps.transport ?? sendEmail
    const result = await transport(
      { deliveryReference: input.deliveryReference, payload },
      emailEnv
    )

    console.info("task_email_delivered", {
      kind: input.kind,
      taskId: input.taskId,
      providerStatus: result.providerStatus,
      providerMessageId: result.providerMessageId,
      durationMs: Date.now() - startedAt,
    })
  } catch (error: unknown) {
    const transportError = error instanceof EmailTransportError ? error : null

    console.error("task_email_delivery_failed", {
      kind: input.kind,
      taskId: input.taskId,
      durationMs: Date.now() - startedAt,
      failureKind: transportError?.kind ?? "unexpected_transport_error",
      providerStatus: transportError?.providerStatus ?? null,
    })

    throw new TaskServiceError(
      "Unable to send the task email. Try again shortly.",
      502
    )
  }
}

/**
 * Formats a task due timestamp for email copy in UTC.
 *
 * @param dueAt - ISO timestamp or null when the task has no due date.
 * @returns Human-readable due date, or null when there is none.
 */
export function formatTaskDueAt(dueAt: string | null): string | null {
  if (dueAt === null) {
    return null
  }

  const dueDate = new Date(dueAt)

  return Number.isNaN(dueDate.getTime())
    ? null
    : `${dueAtFormatter.format(dueDate)} UTC`
}

function createTaskEmailHtml(
  input: SendTaskEmailInput,
  taskUrl: string
): string {
  const copy = TASK_EMAIL_COPY[input.kind]
  const safeTaskTitle = escapeHtml(input.taskTitle)
  const safeTaskUrl = escapeHtml(taskUrl)
  const formattedDueAt = formatTaskDueAt(input.dueAt)
  const greeting = input.recipientName
    ? `<p style="margin:0 0 12px;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;">Hello ${escapeHtml(input.recipientName)},</p>`
    : ""
  const dueLine = formattedDueAt
    ? `<p style="margin:0 0 24px;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;">Due ${escapeHtml(formattedDueAt)}.</p>`
    : ""

  return [
    `<h1 style="margin:0 0 16px;color:#252329;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;line-height:32px;">${copy.heading}</h1>`,
    greeting,
    `<p style="margin:0 0 12px;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;">${copy.intro}</p>`,
    `<p style="margin:0 0 12px;color:#252329;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;line-height:26px;">${safeTaskTitle}</p>`,
    dueLine,
    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-collapse:separate;"><tr><td style="border-radius:8px;background-color:#635273;">',
    `<a href="${safeTaskUrl}" target="_blank" style="display:inline-block;padding:12px 20px;color:#fffdfc;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;">Open task</a>`,
    "</td></tr></table>",
    '<p style="margin:0 0 8px;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">If the button does not work, copy and paste this link into your browser:</p>',
    `<p style="margin:0;overflow-wrap:anywhere;word-break:break-word;"><a href="${safeTaskUrl}" target="_blank" style="color:#635273;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;text-decoration:underline;">${safeTaskUrl}</a></p>`,
  ].join("")
}

function createTaskEmailText(
  input: SendTaskEmailInput,
  taskUrl: string
): string {
  const copy = TASK_EMAIL_COPY[input.kind]
  const formattedDueAt = formatTaskDueAt(input.dueAt)
  const dueSentence = formattedDueAt ? ` Due ${formattedDueAt}.` : ""

  return `${copy.heading}: ${input.taskTitle}.${dueSentence} Open it here: ${taskUrl}`
}
