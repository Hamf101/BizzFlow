/** Days a template stays in Trash before it is deleted for good (see purge_due_trashed_document_templates). */
export const TEMPLATE_TRASH_RETENTION_DAYS = 30

/** Why a template people have answered, or been sent a document made from it to answer, can only be archived. */
export const TEMPLATE_ANSWERED_MESSAGE =
  "People have answered this template or been sent documents made from it, so it can be archived but not deleted."
