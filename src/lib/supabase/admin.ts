import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js"

import { getAdminSupabaseEnv } from "@/lib/env"
import type { DocumentActivityEventRow } from "@/types/activity"
import type { DocumentCommentRow } from "@/types/comment"
import type {
  DocumentRow,
  DocumentVersionRow,
  FolderRow,
} from "@/types/document"
import type {
  DocumentAnswerRow,
  DocumentRecentAccessRow,
  DocumentSigningRecipientRow,
  DocumentSourceKind,
  DocumentTemplateRow,
  TemplateContent,
} from "@/types/template"

type DatabaseOrganizationRole =
  | "owner_admin"
  | "manager"
  | "staff"
  | "external_reviewer"

type DatabaseMembershipStatus = "active" | "disabled"
type DatabaseInviteStatus = "pending" | "accepted" | "revoked" | "expired"

type DatabaseTable<
  Row extends Record<string, unknown>,
  Insert extends Record<string, unknown>,
  Update extends Record<string, unknown>,
> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type ProfileRow = Record<string, unknown> & {
  id: string
  email: string | null
  full_name: string | null
  created_at: string
  updated_at: string
}

type OrganizationRow = Record<string, unknown> & {
  id: string
  name: string
  slug: string
  created_by: string | null
  created_at: string
  updated_at: string
}

type MembershipRow = Record<string, unknown> & {
  id: string
  org_id: string
  user_id: string
  role: DatabaseOrganizationRole
  status: DatabaseMembershipStatus
  created_at: string
  updated_at: string
}

type InviteRow = Record<string, unknown> & {
  id: string
  org_id: string
  email: string
  role: DatabaseOrganizationRole
  token: string
  invited_by: string | null
  status: DatabaseInviteStatus
  expires_at: string
  accepted_by: string | null
  accepted_at: string | null
  created_at: string
  updated_at: string
}

type AuditLogRow = Record<string, unknown> & {
  id: string
  org_id: string
  actor_user_id: string | null
  action: string
  target_type: string
  target_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

type AdminDocumentRow = DocumentRow & {
  source_kind: DocumentSourceKind
  template_id: string | null
  template_revision: number | null
  template_snapshot: TemplateContent | null
}

type AdminSubmissionRow = Record<string, unknown> & {
  id: string
  org_id: string
  title: string
  template_id: string
  template_revision: number
  template_snapshot: TemplateContent
  values: Record<string, string | boolean>
  status: "draft" | "submitted"
  revision: number
  created_by: string | null
  updated_by: string | null
  submitted_by: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
}

type AdminSubmissionFileRow = Record<string, unknown> & {
  id: string
  org_id: string
  submission_id: string
  field_key: string
  status: "upload_pending" | "available" | "superseded"
  storage_key: string
  original_filename: string
  safe_filename: string
  content_type: string
  byte_size: number
  expected_checksum_sha256: string | null
  checksum_sha256: string | null
  uploaded_by: string | null
  superseded_by: string | null
  created_at: string
  updated_at: string
  available_at: string | null
  superseded_at: string | null
  cleanup_after: string
  storage_cleaned_at: string | null
}

type FolderInsert = Partial<FolderRow> & Pick<FolderRow, "id" | "org_id" | "name">
type DocumentInsert = Partial<AdminDocumentRow> &
  Pick<AdminDocumentRow, "id" | "org_id" | "title">
type DocumentVersionInsert = Partial<DocumentVersionRow> &
  Pick<
    DocumentVersionRow,
    | "id"
    | "org_id"
    | "document_id"
    | "version_number"
    | "storage_key"
    | "original_filename"
    | "content_type"
    | "byte_size"
  >
type DocumentCommentInsert = Partial<DocumentCommentRow> &
  Pick<
    DocumentCommentRow,
    "id" | "org_id" | "document_id" | "body" | "created_by"
  >
type DocumentActivityEventInsert = Partial<DocumentActivityEventRow> &
  Pick<
    DocumentActivityEventRow,
    "id" | "org_id" | "document_id" | "event_type"
  >
type DocumentTemplateInsert = Partial<DocumentTemplateRow> &
  Pick<DocumentTemplateRow, "id" | "org_id" | "title" | "content">
type DocumentAnswerInsert = Partial<DocumentAnswerRow> &
  Pick<DocumentAnswerRow, "document_id" | "org_id">
type DocumentSigningRecipientInsert = Partial<DocumentSigningRecipientRow> &
  Pick<
    DocumentSigningRecipientRow,
    | "id"
    | "org_id"
    | "document_id"
    | "name"
    | "email"
    | "token_hash"
    | "token_expires_at"
  >
type DocumentRecentAccessInsert = Pick<
  DocumentRecentAccessRow,
  "org_id" | "user_id" | "document_id" | "last_opened_at"
>

export type AdminDatabase = {
  public: {
    Tables: {
      profiles: DatabaseTable<
        ProfileRow,
        Partial<ProfileRow> & Pick<ProfileRow, "id">,
        Partial<ProfileRow>
      >
      organizations: DatabaseTable<
        OrganizationRow,
        Partial<OrganizationRow> & Pick<OrganizationRow, "name" | "slug">,
        Partial<OrganizationRow>
      >
      organization_memberships: DatabaseTable<
        MembershipRow,
        Partial<MembershipRow> & Pick<MembershipRow, "org_id" | "user_id" | "role">,
        Partial<MembershipRow>
      >
      invites: DatabaseTable<
        InviteRow,
        Partial<InviteRow> & Pick<InviteRow, "org_id" | "email" | "role" | "token">,
        Partial<InviteRow>
      >
      audit_logs: DatabaseTable<
        AuditLogRow,
        Partial<AuditLogRow> &
          Pick<AuditLogRow, "org_id" | "action" | "target_type">,
        Partial<AuditLogRow>
      >
      folders: DatabaseTable<FolderRow, FolderInsert, Partial<FolderRow>>
      documents: DatabaseTable<
        AdminDocumentRow,
        DocumentInsert,
        Partial<AdminDocumentRow>
      >
      document_versions: DatabaseTable<
        DocumentVersionRow,
        DocumentVersionInsert,
        Partial<DocumentVersionRow>
      >
      document_comments: DatabaseTable<
        DocumentCommentRow,
        DocumentCommentInsert,
        Partial<DocumentCommentRow>
      >
      document_activity_events: DatabaseTable<
        DocumentActivityEventRow,
        DocumentActivityEventInsert,
        Partial<DocumentActivityEventRow>
      >
      document_templates: DatabaseTable<
        DocumentTemplateRow,
        DocumentTemplateInsert,
        Partial<DocumentTemplateRow>
      >
      document_answers: DatabaseTable<
        DocumentAnswerRow,
        DocumentAnswerInsert,
        Partial<DocumentAnswerRow>
      >
      document_signing_recipients: DatabaseTable<
        DocumentSigningRecipientRow,
        DocumentSigningRecipientInsert,
        Partial<DocumentSigningRecipientRow>
      >
      document_recent_accesses: DatabaseTable<
        DocumentRecentAccessRow,
        DocumentRecentAccessInsert,
        Partial<DocumentRecentAccessRow>
      >
      submissions: DatabaseTable<
        AdminSubmissionRow,
        Partial<AdminSubmissionRow> &
          Pick<
            AdminSubmissionRow,
            "id" | "org_id" | "title" | "template_id" | "template_snapshot"
          >,
        Partial<AdminSubmissionRow>
      >
      submission_files: DatabaseTable<
        AdminSubmissionFileRow,
        Partial<AdminSubmissionFileRow> &
          Pick<
            AdminSubmissionFileRow,
            | "id"
            | "org_id"
            | "submission_id"
            | "field_key"
            | "storage_key"
            | "original_filename"
            | "safe_filename"
            | "content_type"
            | "byte_size"
          >,
        Partial<AdminSubmissionFileRow>
      >
    }
    Views: Record<string, never>
    Functions: {
      accept_organization_invite: {
        Args: {
          target_invite_id: string
          target_token: string
          target_user_id: string
          target_user_email: string
        }
        Returns: string
      }
      archive_document: {
        Args: {
          target_org_id: string
          target_document_id: string
          target_actor_user_id: string
        }
        Returns: boolean
      }
      create_document_comment: {
        Args: {
          target_org_id: string
          target_document_id: string
          target_comment_id: string
          target_body: string
          target_actor_user_id: string
        }
        Returns: string
      }
      create_pending_document_version: {
        Args: {
          target_org_id: string
          target_document_id: string
          target_version_id: string
          target_storage_key: string
          target_original_filename: string
          target_content_type: string
          target_byte_size: number
          target_checksum_sha256: string | null
          target_uploaded_by: string
        }
        Returns: string
      }
      complete_document_version: {
        Args: {
          target_org_id: string
          target_document_id: string
          target_version_id: string
          target_actor_user_id: string
        }
        Returns: boolean
      }
      complete_document_recipient_signature: {
        Args: {
          target_org_id: string
          target_document_id: string
          target_recipient_id: string
          target_token_hash: string
          target_values: Record<string, unknown>
          target_signature_data: Record<string, unknown> | null
          target_initials_data: Record<string, unknown> | null
        }
        Returns: string
      }
      merge_generated_document_answers: {
        Args: {
          target_org_id: string
          target_document_id: string
          target_values: Record<string, unknown>
        }
        Returns: Record<string, unknown>
      }
      create_internal_submission_draft: {
        Args: {
          target_org_id: string
          target_template_id: string
          target_submission_id: string
          target_title: string
          target_actor_user_id: string
        }
        Returns: AdminSubmissionRow
      }
      save_internal_submission_draft: {
        Args: {
          target_org_id: string
          target_submission_id: string
          target_expected_revision: number
          target_values: Record<string, string | boolean>
          target_actor_user_id: string
        }
        Returns: AdminSubmissionRow
      }
      allocate_internal_submission_file: {
        Args: {
          target_org_id: string
          target_submission_id: string
          target_expected_revision: number
          target_file_id: string
          target_field_key: string
          target_original_filename: string
          target_safe_filename: string
          target_content_type: string
          target_byte_size: number
          target_storage_key: string
          target_expected_checksum_sha256: string
          target_actor_user_id: string
        }
        Returns: AdminSubmissionFileRow
      }
      complete_internal_submission_file: {
        Args: {
          target_org_id: string
          target_submission_id: string
          target_file_id: string
          target_storage_key: string
          target_content_type: string
          target_byte_size: number
          target_checksum_sha256: string | null
          target_actor_user_id: string
        }
        Returns: AdminSubmissionFileRow
      }
      supersede_internal_submission_file: {
        Args: {
          target_org_id: string
          target_submission_id: string
          target_file_id: string
          target_actor_user_id: string
        }
        Returns: AdminSubmissionFileRow
      }
      record_internal_submission_file_upload_window: {
        Args: {
          target_org_id: string
          target_submission_id: string
          target_file_id: string
          target_cleanup_after: string
          target_actor_user_id: string
        }
        Returns: AdminSubmissionFileRow
      }
      mark_internal_submission_file_storage_cleaned: {
        Args: {
          target_file_id: string
          target_storage_key: string
        }
        Returns: AdminSubmissionFileRow
      }
      submit_internal_submission: {
        Args: {
          target_org_id: string
          target_submission_id: string
          target_expected_revision: number
          target_values: Record<string, string | boolean>
          target_actor_user_id: string
        }
        Returns: AdminSubmissionRow
      }
      update_organization_member_role: {
        Args: {
          target_org_id: string
          target_membership_id: string
          target_actor_user_id: string
          target_role: DatabaseOrganizationRole
        }
        Returns: string
      }
    }
  }
}

export type AdminSupabaseClient = SupabaseClient<AdminDatabase>

/**
 * Creates a secret-key Supabase client for trusted server-side workflows.
 *
 * @returns Typed Supabase admin client for server-only data access.
 * @throws Error when required Supabase environment variables are missing.
 */
export function createAdminClient(): AdminSupabaseClient {
  const env = getAdminSupabaseEnv()

  return createSupabaseClient<AdminDatabase>(
    env.SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
