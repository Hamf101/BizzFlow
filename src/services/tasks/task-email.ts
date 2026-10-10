import type { EmailTransport } from "@/services/email/contracts"
import { escapeHtml } from "@/services/email/html"
import { deliverTransactionalEmail } from "@/services/email/transport"
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
  const copy = TASK_EMAIL_COPY[input.kind]

  await deliverTransactionalEmail({
    name: "task",
    logPrefix: "task_email",
    ids: { kind: input.kind, taskId: input.taskId },
    path: () => `/tasks/${encodeURIComponent(input.taskId)}`,
    deliveryReference: input.deliveryReference,
    toEmail: input.recipientEmail,
    compose: (taskUrl) => ({
      subject: `${copy.subjectPrefix}: ${input.taskTitle}`,
      contentHtml: createTaskEmailHtml(input, taskUrl),
      text: createTaskEmailText(input, taskUrl),
    }),
    fail: (message, statusCode) => new TaskServiceError(message, statusCode),
    explainRejection: false,
    transport: deps.transport,
  })
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
