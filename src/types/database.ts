export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          org_id: string
          seq: number
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id: string
          seq?: number
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string
          seq?: number
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_access_grants: {
        Row: {
          access_level: Database["public"]["Enums"]["resource_access_level"]
          created_at: string
          document_id: string
          granted_by: string | null
          id: string
          org_id: string
          organization_role:
            | Database["public"]["Enums"]["organization_role"]
            | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_level: Database["public"]["Enums"]["resource_access_level"]
          created_at?: string
          document_id: string
          granted_by?: string | null
          id?: string
          org_id: string
          organization_role?:
            | Database["public"]["Enums"]["organization_role"]
            | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_level?: Database["public"]["Enums"]["resource_access_level"]
          created_at?: string
          document_id?: string
          granted_by?: string | null
          id?: string
          org_id?: string
          organization_role?:
            | Database["public"]["Enums"]["organization_role"]
            | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_access_grants_document_org_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "document_access_grants_granted_by_membership_fkey"
            columns: ["org_id", "granted_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["org_id", "user_id"]
          },
          {
            foreignKeyName: "document_access_grants_user_membership_fkey"
            columns: ["org_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["org_id", "user_id"]
          },
        ]
      }
      document_activity_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          document_id: string
          event_type: string
          id: string
          metadata: Json
          org_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          document_id: string
          event_type: string
          id?: string
          metadata?: Json
          org_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          document_id?: string
          event_type?: string
          id?: string
          metadata?: Json
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_activity_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_activity_events_document_id_org_id_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "document_activity_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_answers: {
        Row: {
          created_at: string
          document_id: string
          org_id: string
          updated_at: string
          values: Json
          workflow_status: string
        }
        Insert: {
          created_at?: string
          document_id: string
          org_id: string
          updated_at?: string
          values?: Json
          workflow_status?: string
        }
        Update: {
          created_at?: string
          document_id?: string
          org_id?: string
          updated_at?: string
          values?: Json
          workflow_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_answers_document_id_org_id_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "document_answers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_comments: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          document_id: string
          id: string
          org_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          document_id: string
          id?: string
          org_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          document_id?: string
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_comments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_comments_document_id_org_id_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "document_comments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_guest_grants: {
        Row: {
          accepted_at: string | null
          access_level: Database["public"]["Enums"]["resource_access_level"]
          created_at: string
          document_id: string
          email: string
          id: string
          invite_expires_at: string | null
          invite_token_hash: string | null
          invited_by: string | null
          org_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          access_level: Database["public"]["Enums"]["resource_access_level"]
          created_at?: string
          document_id: string
          email: string
          id?: string
          invite_expires_at?: string | null
          invite_token_hash?: string | null
          invited_by?: string | null
          org_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          access_level?: Database["public"]["Enums"]["resource_access_level"]
          created_at?: string
          document_id?: string
          email?: string
          id?: string
          invite_expires_at?: string | null
          invite_token_hash?: string | null
          invited_by?: string | null
          org_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_guest_grants_document_org_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "document_guest_grants_invited_by_membership_fkey"
            columns: ["org_id", "invited_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["org_id", "user_id"]
          },
          {
            foreignKeyName: "document_guest_grants_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_guest_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_recent_accesses: {
        Row: {
          document_id: string
          last_opened_at: string
          org_id: string
          user_id: string
        }
        Insert: {
          document_id: string
          last_opened_at?: string
          org_id: string
          user_id: string
        }
        Update: {
          document_id?: string
          last_opened_at?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_recent_accesses_document_id_org_id_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "document_recent_accesses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_recent_accesses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_signed_copy_links: {
        Row: {
          created_at: string
          document_id: string
          email: string
          expires_at: string
          id: string
          org_id: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          document_id: string
          email: string
          expires_at?: string
          id?: string
          org_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          document_id?: string
          email?: string
          expires_at?: string
          id?: string
          org_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_signed_copy_links_document_org_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "document_signed_copy_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_signing_recipients: {
        Row: {
          consented_at: string | null
          decline_reason: string | null
          declined_at: string | null
          document_id: string
          email: string
          id: string
          initials_data: Json | null
          invited_at: string
          name: string
          org_id: string
          requires_signature: boolean
          revoked_at: string | null
          sent_by: string | null
          signature_data: Json | null
          signed_at: string | null
          signed_ip: string | null
          signer_number: number
          status: string
          token_expires_at: string
          token_hash: string
          user_id: string | null
          viewed_at: string | null
        }
        Insert: {
          consented_at?: string | null
          decline_reason?: string | null
          declined_at?: string | null
          document_id: string
          email: string
          id?: string
          initials_data?: Json | null
          invited_at?: string
          name: string
          org_id: string
          requires_signature?: boolean
          revoked_at?: string | null
          sent_by?: string | null
          signature_data?: Json | null
          signed_at?: string | null
          signed_ip?: string | null
          signer_number: number
          status?: string
          token_expires_at: string
          token_hash: string
          user_id?: string | null
          viewed_at?: string | null
        }
        Update: {
          consented_at?: string | null
          decline_reason?: string | null
          declined_at?: string | null
          document_id?: string
          email?: string
          id?: string
          initials_data?: Json | null
          invited_at?: string
          name?: string
          org_id?: string
          requires_signature?: boolean
          revoked_at?: string | null
          sent_by?: string | null
          signature_data?: Json | null
          signed_at?: string | null
          signed_ip?: string | null
          signer_number?: number
          status?: string
          token_expires_at?: string
          token_hash?: string
          user_id?: string | null
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_signing_recipients_document_id_org_id_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "document_signing_recipients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_signing_recipients_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_signing_recipients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_template_versions: {
        Row: {
          content: Json
          description: string | null
          org_id: string
          published_at: string
          published_by: string | null
          revision: number
          template_id: string
          title: string
        }
        Insert: {
          content: Json
          description?: string | null
          org_id: string
          published_at: string
          published_by?: string | null
          revision: number
          template_id: string
          title: string
        }
        Update: {
          content?: Json
          description?: string | null
          org_id?: string
          published_at?: string
          published_by?: string | null
          revision?: number
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_template_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_template_versions_template_id_org_id_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "document_template_versions_template_id_org_id_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "published_document_templates"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      document_templates: {
        Row: {
          access_restricted: boolean
          archived_at: string | null
          archived_by: string | null
          category: string | null
          content: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          org_id: string
          pre_trash_status: string | null
          published_at: string | null
          published_by: string | null
          published_revision: number | null
          revision: number
          status: string
          title: string
          trashed_at: string | null
          trashed_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          access_restricted?: boolean
          archived_at?: string | null
          archived_by?: string | null
          category?: string | null
          content: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          org_id: string
          pre_trash_status?: string | null
          published_at?: string | null
          published_by?: string | null
          published_revision?: number | null
          revision?: number
          status?: string
          title: string
          trashed_at?: string | null
          trashed_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          access_restricted?: boolean
          archived_at?: string | null
          archived_by?: string | null
          category?: string | null
          content?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          org_id?: string
          pre_trash_status?: string | null
          published_at?: string | null
          published_by?: string | null
          published_revision?: number | null
          revision?: number
          status?: string
          title?: string
          trashed_at?: string | null
          trashed_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_published_version_fkey"
            columns: ["org_id", "id", "published_revision"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["org_id", "template_id", "revision"]
          },
          {
            foreignKeyName: "document_templates_trashed_by_fkey"
            columns: ["trashed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_versions: {
        Row: {
          byte_size: number
          checksum_sha256: string | null
          content_type: string
          created_at: string
          document_id: string
          id: string
          org_id: string
          original_filename: string
          status: string
          storage_key: string
          updated_at: string
          upload_authorization_expires_at: string | null
          uploaded_by: string | null
          version_number: number
        }
        Insert: {
          byte_size: number
          checksum_sha256?: string | null
          content_type: string
          created_at?: string
          document_id: string
          id?: string
          org_id: string
          original_filename: string
          status?: string
          storage_key: string
          updated_at?: string
          upload_authorization_expires_at?: string | null
          uploaded_by?: string | null
          version_number: number
        }
        Update: {
          byte_size?: number
          checksum_sha256?: string | null
          content_type?: string
          created_at?: string
          document_id?: string
          id?: string
          org_id?: string
          original_filename?: string
          status?: string
          storage_key?: string
          updated_at?: string
          upload_authorization_expires_at?: string | null
          uploaded_by?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_org_id_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "document_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          conversion_error: string | null
          conversion_state: string | null
          created_at: string
          created_by: string | null
          current_version_id: string | null
          description: string | null
          folder_id: string | null
          id: string
          lifecycle_state: Database["public"]["Enums"]["resource_lifecycle_state"]
          org_id: string
          original_version_id: string | null
          pre_trash_lifecycle_state:
            | Database["public"]["Enums"]["resource_lifecycle_state"]
            | null
          purge_after: string | null
          share_inherit: boolean
          sheet_content: Json | null
          source_kind: string
          template_id: string | null
          template_revision: number | null
          template_snapshot: Json | null
          title: string
          trash_operation_id: string | null
          trashed_at: string | null
          trashed_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          conversion_error?: string | null
          conversion_state?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          description?: string | null
          folder_id?: string | null
          id?: string
          lifecycle_state?: Database["public"]["Enums"]["resource_lifecycle_state"]
          org_id: string
          original_version_id?: string | null
          pre_trash_lifecycle_state?:
            | Database["public"]["Enums"]["resource_lifecycle_state"]
            | null
          purge_after?: string | null
          share_inherit?: boolean
          sheet_content?: Json | null
          source_kind?: string
          template_id?: string | null
          template_revision?: number | null
          template_snapshot?: Json | null
          title: string
          trash_operation_id?: string | null
          trashed_at?: string | null
          trashed_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          conversion_error?: string | null
          conversion_state?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          description?: string | null
          folder_id?: string | null
          id?: string
          lifecycle_state?: Database["public"]["Enums"]["resource_lifecycle_state"]
          org_id?: string
          original_version_id?: string | null
          pre_trash_lifecycle_state?:
            | Database["public"]["Enums"]["resource_lifecycle_state"]
            | null
          purge_after?: string | null
          share_inherit?: boolean
          sheet_content?: Json | null
          source_kind?: string
          template_id?: string | null
          template_revision?: number | null
          template_snapshot?: Json | null
          title?: string
          trash_operation_id?: string | null
          trashed_at?: string | null
          trashed_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_current_version_id_document_id_fkey"
            columns: ["current_version_id", "id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "document_id"]
          },
          {
            foreignKeyName: "documents_folder_id_org_id_fkey"
            columns: ["folder_id", "org_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_original_version_id_document_id_fkey"
            columns: ["original_version_id", "id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "document_id"]
          },
          {
            foreignKeyName: "documents_template_id_org_id_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "documents_template_id_org_id_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "published_document_templates"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "documents_trashed_by_fkey"
            columns: ["trashed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      folder_access_grants: {
        Row: {
          access_level: Database["public"]["Enums"]["resource_access_level"]
          created_at: string
          folder_id: string
          granted_by: string | null
          id: string
          org_id: string
          organization_role:
            | Database["public"]["Enums"]["organization_role"]
            | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_level: Database["public"]["Enums"]["resource_access_level"]
          created_at?: string
          folder_id: string
          granted_by?: string | null
          id?: string
          org_id: string
          organization_role?:
            | Database["public"]["Enums"]["organization_role"]
            | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_level?: Database["public"]["Enums"]["resource_access_level"]
          created_at?: string
          folder_id?: string
          granted_by?: string | null
          id?: string
          org_id?: string
          organization_role?:
            | Database["public"]["Enums"]["organization_role"]
            | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folder_access_grants_folder_org_fkey"
            columns: ["folder_id", "org_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "folder_access_grants_granted_by_membership_fkey"
            columns: ["org_id", "granted_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["org_id", "user_id"]
          },
          {
            foreignKeyName: "folder_access_grants_user_membership_fkey"
            columns: ["org_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["org_id", "user_id"]
          },
        ]
      }
      folders: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          id: string
          lifecycle_state: Database["public"]["Enums"]["resource_lifecycle_state"]
          name: string
          org_id: string
          parent_folder_id: string | null
          pre_trash_lifecycle_state:
            | Database["public"]["Enums"]["resource_lifecycle_state"]
            | null
          purge_after: string | null
          share_inherit: boolean
          trash_operation_id: string | null
          trashed_at: string | null
          trashed_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lifecycle_state?: Database["public"]["Enums"]["resource_lifecycle_state"]
          name: string
          org_id: string
          parent_folder_id?: string | null
          pre_trash_lifecycle_state?:
            | Database["public"]["Enums"]["resource_lifecycle_state"]
            | null
          purge_after?: string | null
          share_inherit?: boolean
          trash_operation_id?: string | null
          trashed_at?: string | null
          trashed_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lifecycle_state?: Database["public"]["Enums"]["resource_lifecycle_state"]
          name?: string
          org_id?: string
          parent_folder_id?: string | null
          pre_trash_lifecycle_state?:
            | Database["public"]["Enums"]["resource_lifecycle_state"]
            | null
          purge_after?: string | null
          share_inherit?: boolean
          trash_operation_id?: string | null
          trashed_at?: string | null
          trashed_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folders_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_parent_folder_id_org_id_fkey"
            columns: ["parent_folder_id", "org_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "folders_trashed_by_fkey"
            columns: ["trashed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_document_finalizations: {
        Row: {
          byte_size: number | null
          created_at: string
          created_by: string | null
          document_id: string
          document_version_id: string | null
          finalized_at: string | null
          finalized_by: string | null
          id: string
          org_id: string
          pdf_sha256: string | null
          render_input_sha256: string
          status: string
          storage_key: string
        }
        Insert: {
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          document_id: string
          document_version_id?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id: string
          org_id: string
          pdf_sha256?: string | null
          render_input_sha256: string
          status?: string
          storage_key: string
        }
        Update: {
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          document_id?: string
          document_version_id?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          org_id?: string
          pdf_sha256?: string | null
          render_input_sha256?: string
          status?: string
          storage_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_document_finalizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_document_finalizations_document_id_org_id_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "generated_document_finalizations_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_document_finalizations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_document_finalizations_version_document_fkey"
            columns: ["document_version_id", "document_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "document_id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          role: Database["public"]["Enums"]["organization_role"]
          role_definition_id: string
          status: Database["public"]["Enums"]["invite_status"]
          token: string | null
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id: string
          role?: Database["public"]["Enums"]["organization_role"]
          role_definition_id: string
          status?: Database["public"]["Enums"]["invite_status"]
          token?: string | null
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["organization_role"]
          role_definition_id?: string
          status?: Database["public"]["Enums"]["invite_status"]
          token?: string | null
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_role_definition_fk"
            columns: ["org_id", "role_definition_id"]
            isOneToOne: false
            referencedRelation: "organization_roles"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          attempt_count: number
          channel: string
          created_at: string
          id: string
          last_error: string | null
          org_id: string
          purpose: string
          recipient_user_id: string | null
          reference: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          channel: string
          created_at?: string
          id?: string
          last_error?: string | null
          org_id: string
          purpose: string
          recipient_user_id?: string | null
          reference: string
          status: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          channel?: string
          created_at?: string
          id?: string
          last_error?: string | null
          org_id?: string
          purpose?: string
          recipient_user_id?: string | null
          reference?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          email_notifications_enabled: boolean
          id: string
          navigation_order: string[]
          org_id: string
          role: Database["public"]["Enums"]["organization_role"]
          role_definition_id: string
          sms_notifications_enabled: boolean
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
          workspace_display_name: string | null
        }
        Insert: {
          created_at?: string
          email_notifications_enabled?: boolean
          id?: string
          navigation_order?: string[]
          org_id: string
          role: Database["public"]["Enums"]["organization_role"]
          role_definition_id: string
          sms_notifications_enabled?: boolean
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
          workspace_display_name?: string | null
        }
        Update: {
          created_at?: string
          email_notifications_enabled?: boolean
          id?: string
          navigation_order?: string[]
          org_id?: string
          role?: Database["public"]["Enums"]["organization_role"]
          role_definition_id?: string
          sms_notifications_enabled?: boolean
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
          workspace_display_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_role_definition_fk"
            columns: ["org_id", "role_definition_id"]
            isOneToOne: false
            referencedRelation: "organization_roles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "organization_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_roles: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          org_id: string
          permissions: string[] | null
          system_key: Database["public"]["Enums"]["organization_role"] | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          org_id: string
          permissions?: string[] | null
          system_key?: Database["public"]["Enums"]["organization_role"] | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          permissions?: string[] | null
          system_key?: Database["public"]["Enums"]["organization_role"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          email_notifications_enabled: boolean
          id: string
          name: string
          navigation_labels: Json
          navigation_revision: number
          slug: string
          sms_notifications_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email_notifications_enabled?: boolean
          id?: string
          name: string
          navigation_labels?: Json
          navigation_revision?: number
          slug: string
          sms_notifications_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email_notifications_enabled?: boolean
          id?: string
          name?: string
          navigation_labels?: Json
          navigation_revision?: number
          slug?: string
          sms_notifications_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          editor_layout: Json
          email: string | null
          full_name: string | null
          id: string
          phone_number: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          editor_layout?: Json
          email?: string | null
          full_name?: string | null
          id: string
          phone_number?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          editor_layout?: Json
          email?: string | null
          full_name?: string | null
          id?: string
          phone_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      public_form_links: {
        Row: {
          answers_snapshot: Json | null
          content_snapshot: Json | null
          created_at: string
          created_by: string | null
          document_id: string | null
          expires_at: string | null
          id: string
          label: string | null
          max_submissions: number | null
          org_id: string
          recipient_email: string | null
          sent_by: string | null
          signer: number | null
          status: string
          submission_count: number
          template_id: string
          template_revision_snapshot: number | null
          title_snapshot: string | null
          token_hash: string
          updated_at: string
        }
        Insert: {
          answers_snapshot?: Json | null
          content_snapshot?: Json | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          max_submissions?: number | null
          org_id: string
          recipient_email?: string | null
          sent_by?: string | null
          signer?: number | null
          status?: string
          submission_count?: number
          template_id: string
          template_revision_snapshot?: number | null
          title_snapshot?: string | null
          token_hash: string
          updated_at?: string
        }
        Update: {
          answers_snapshot?: Json | null
          content_snapshot?: Json | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          max_submissions?: number | null
          org_id?: string
          recipient_email?: string | null
          sent_by?: string | null
          signer?: number | null
          status?: string
          submission_count?: number
          template_id?: string
          template_revision_snapshot?: number | null
          title_snapshot?: string | null
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_form_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_form_links_document_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "public_form_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_form_links_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_form_links_template_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "public_form_links_template_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "published_document_templates"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      resource_purge_jobs: {
        Row: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          failed_at: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          max_attempts: number
          org_id: string
          request_kind: string
          requested_at: string
          requested_by: string | null
          root_resource_id: string
          root_resource_kind: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          failed_at?: string | null
          id: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          org_id: string
          request_kind: string
          requested_at?: string
          requested_by?: string | null
          root_resource_id: string
          root_resource_kind: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          failed_at?: string | null
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          org_id?: string
          request_kind?: string
          requested_at?: string
          requested_by?: string | null
          root_resource_id?: string
          root_resource_kind?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_purge_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_purge_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_purge_members: {
        Row: {
          depth: number
          id: string
          job_id: string
          org_id: string
          resource_id: string
          resource_kind: string
        }
        Insert: {
          depth?: number
          id?: string
          job_id: string
          org_id: string
          resource_id: string
          resource_kind: string
        }
        Update: {
          depth?: number
          id?: string
          job_id?: string
          org_id?: string
          resource_id?: string
          resource_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_purge_members_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "resource_purge_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_purge_members_job_org_fkey"
            columns: ["job_id", "org_id"]
            isOneToOne: false
            referencedRelation: "resource_purge_jobs"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      resource_purge_objects: {
        Row: {
          attempt_count: number
          available_at: string
          created_at: string
          deleted_at: string | null
          id: string
          job_id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          max_attempts: number
          object_kind: string
          org_id: string
          status: string
          storage_key: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          job_id: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          object_kind?: string
          org_id: string
          status?: string
          storage_key: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          job_id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          object_kind?: string
          org_id?: string
          status?: string
          storage_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_purge_objects_job_org_fkey"
            columns: ["job_id", "org_id"]
            isOneToOne: false
            referencedRelation: "resource_purge_jobs"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      resource_purge_receipts: {
        Row: {
          document_count: number
          folder_count: number
          id: string
          job_id: string
          object_count: number
          org_id: string
          purged_at: string
          request_kind: string
          requested_by: string | null
          root_resource_id: string
          root_resource_kind: string
        }
        Insert: {
          document_count: number
          folder_count: number
          id: string
          job_id: string
          object_count: number
          org_id: string
          purged_at: string
          request_kind: string
          requested_by?: string | null
          root_resource_id: string
          root_resource_kind: string
        }
        Update: {
          document_count?: number
          folder_count?: number
          id?: string
          job_id?: string
          object_count?: number
          org_id?: string
          purged_at?: string
          request_kind?: string
          requested_by?: string | null
          root_resource_id?: string
          root_resource_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_purge_receipts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_purge_receipts_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_purge_tombstones: {
        Row: {
          org_id: string
          purged_at: string
          resource_id: string
          resource_kind: string
          root_job_id: string
        }
        Insert: {
          org_id: string
          purged_at: string
          resource_id: string
          resource_kind: string
          root_job_id: string
        }
        Update: {
          org_id?: string
          purged_at?: string
          resource_id?: string
          resource_kind?: string
          root_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_purge_tombstones_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_list_views: {
        Row: {
          created_at: string
          id: string
          list: string
          name: string
          org_id: string
          query: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          list: string
          name: string
          org_id: string
          query: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          list?: string
          name?: string
          org_id?: string
          query?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_list_views_org_id_user_id_fkey"
            columns: ["org_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["org_id", "user_id"]
          },
        ]
      }
      submission_activity_events: {
        Row: {
          actor_user_id: string | null
          assignee_user_id: string | null
          comment_id: string | null
          created_at: string
          event_type: string
          from_status: string
          id: string
          org_id: string
          submission_id: string
          submission_revision: number
          to_status: string
        }
        Insert: {
          actor_user_id?: string | null
          assignee_user_id?: string | null
          comment_id?: string | null
          created_at?: string
          event_type: string
          from_status: string
          id?: string
          org_id: string
          submission_id: string
          submission_revision: number
          to_status: string
        }
        Update: {
          actor_user_id?: string | null
          assignee_user_id?: string | null
          comment_id?: string | null
          created_at?: string
          event_type?: string
          from_status?: string
          id?: string
          org_id?: string
          submission_id?: string
          submission_revision?: number
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_activity_comment_id_fkey"
            columns: ["comment_id", "org_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "submission_comments"
            referencedColumns: ["id", "org_id", "submission_id"]
          },
          {
            foreignKeyName: "submission_activity_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_activity_events_assignee_user_id_fkey"
            columns: ["assignee_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_activity_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_activity_submission_id_org_id_fkey"
            columns: ["submission_id", "org_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      submission_answer_suggestions: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          field_key: string
          id: string
          org_id: string
          previous_value: Json | null
          proposed_value: Json
          status: string
          submission_id: string
          suggested_at: string
          suggested_by: string | null
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          field_key: string
          id?: string
          org_id: string
          previous_value?: Json | null
          proposed_value: Json
          status?: string
          submission_id: string
          suggested_at?: string
          suggested_by?: string | null
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          field_key?: string
          id?: string
          org_id?: string
          previous_value?: Json | null
          proposed_value?: Json
          status?: string
          submission_id?: string
          suggested_at?: string
          suggested_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submission_answer_suggestions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_answer_suggestions_submission_org_fkey"
            columns: ["submission_id", "org_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "submission_answer_suggestions_suggested_by_fkey"
            columns: ["suggested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_comments: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          submission_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          org_id: string
          submission_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          org_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_comments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_comments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_comments_submission_id_org_id_fkey"
            columns: ["submission_id", "org_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      submission_files: {
        Row: {
          available_at: string | null
          byte_size: number
          checksum_sha256: string | null
          cleanup_after: string
          content_type: string
          created_at: string
          expected_checksum_sha256: string | null
          field_key: string
          id: string
          org_id: string
          original_filename: string
          safe_filename: string
          status: string
          storage_cleaned_at: string | null
          storage_key: string
          submission_id: string
          superseded_at: string | null
          superseded_by: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          available_at?: string | null
          byte_size: number
          checksum_sha256?: string | null
          cleanup_after?: string
          content_type: string
          created_at?: string
          expected_checksum_sha256?: string | null
          field_key: string
          id?: string
          org_id: string
          original_filename: string
          safe_filename: string
          status?: string
          storage_cleaned_at?: string | null
          storage_key: string
          submission_id: string
          superseded_at?: string | null
          superseded_by?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          available_at?: string | null
          byte_size?: number
          checksum_sha256?: string | null
          cleanup_after?: string
          content_type?: string
          created_at?: string
          expected_checksum_sha256?: string | null
          field_key?: string
          id?: string
          org_id?: string
          original_filename?: string
          safe_filename?: string
          status?: string
          storage_cleaned_at?: string | null
          storage_key?: string
          submission_id?: string
          superseded_at?: string | null
          superseded_by?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submission_files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_files_submission_id_org_id_fkey"
            columns: ["submission_id", "org_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "submission_files_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_reviewers: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          can_approve: boolean
          decided_at: string | null
          decision: string
          note: string | null
          org_id: string
          submission_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          can_approve?: boolean
          decided_at?: string | null
          decision?: string
          note?: string | null
          org_id: string
          submission_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          can_approve?: boolean
          decided_at?: string | null
          decision?: string
          note?: string | null
          org_id?: string
          submission_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_reviewers_submission_org_fkey"
            columns: ["submission_id", "org_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "submission_reviewers_user_membership_fkey"
            columns: ["org_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["org_id", "user_id"]
          },
        ]
      }
      submissions: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          public_draft_token: string | null
          public_form_link_id: string | null
          required_approvals: number | null
          revision: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          org_id: string
          public_draft_token?: string | null
          public_form_link_id?: string | null
          required_approvals?: number | null
          revision?: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at?: string
          updated_by?: string | null
          values?: Json
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          org_id?: string
          public_draft_token?: string | null
          public_form_link_id?: string | null
          required_approvals?: number | null
          revision?: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          template_id?: string
          template_revision?: number
          template_snapshot?: Json
          title?: string
          updated_at?: string
          updated_by?: string | null
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "submissions_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_public_form_link_fkey"
            columns: ["public_form_link_id", "org_id"]
            isOneToOne: false
            referencedRelation: "public_form_links"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_template_id_org_id_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "submissions_template_id_org_id_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "published_document_templates"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "submissions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_reminders: {
        Row: {
          attempt_count: number
          channel: string
          created_at: string
          created_by: string | null
          id: string
          last_error: string | null
          org_id: string
          origin: string
          recipient_user_id: string
          remind_at: string
          sent_at: string | null
          status: string
          task_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          org_id: string
          origin?: string
          recipient_user_id: string
          remind_at: string
          sent_at?: string | null
          status?: string
          task_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          org_id?: string
          origin?: string
          recipient_user_id?: string
          remind_at?: string
          sent_at?: string | null
          status?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reminders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reminders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reminders_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reminders_task_id_org_id_fkey"
            columns: ["task_id", "org_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          org_id: string
          revision: number
          status: string
          submission_id: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          org_id: string
          revision?: number
          status?: string
          submission_id?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          org_id?: string
          revision?: number
          status?: string
          submission_id?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_submission_id_fkey"
            columns: ["submission_id", "org_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "tasks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      template_access_grants: {
        Row: {
          access_level: Database["public"]["Enums"]["template_access_level"]
          created_at: string
          granted_by: string | null
          id: string
          org_id: string
          organization_role:
            | Database["public"]["Enums"]["organization_role"]
            | null
          template_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_level: Database["public"]["Enums"]["template_access_level"]
          created_at?: string
          granted_by?: string | null
          id?: string
          org_id: string
          organization_role?:
            | Database["public"]["Enums"]["organization_role"]
            | null
          template_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_level?: Database["public"]["Enums"]["template_access_level"]
          created_at?: string
          granted_by?: string | null
          id?: string
          org_id?: string
          organization_role?:
            | Database["public"]["Enums"]["organization_role"]
            | null
          template_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_access_grants_granted_by_membership_fkey"
            columns: ["org_id", "granted_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["org_id", "user_id"]
          },
          {
            foreignKeyName: "template_access_grants_template_org_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "template_access_grants_template_org_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "published_document_templates"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "template_access_grants_user_membership_fkey"
            columns: ["org_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["org_id", "user_id"]
          },
        ]
      }
      template_flow_messages: {
        Row: {
          author_name: string | null
          author_user_id: string | null
          change_set: Json | null
          content: string
          created_at: string
          id: string
          org_id: string
          role: string
          template_id: string
        }
        Insert: {
          author_name?: string | null
          author_user_id?: string | null
          change_set?: Json | null
          content: string
          created_at?: string
          id?: string
          org_id: string
          role: string
          template_id: string
        }
        Update: {
          author_name?: string | null
          author_user_id?: string | null
          change_set?: Json | null
          content?: string
          created_at?: string
          id?: string
          org_id?: string
          role?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_flow_messages_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_flow_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_flow_messages_template_org_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "template_flow_messages_template_org_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "published_document_templates"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      working_copy_checkpoints: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string
          org_id: string
          restored_from: string | null
          revision: number
          room_id: string
          schema_version: number
          value: Json
          value_hash: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id: string
          label: string
          org_id: string
          restored_from?: string | null
          revision: number
          room_id: string
          schema_version: number
          value: Json
          value_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          org_id?: string
          restored_from?: string | null
          revision?: number
          room_id?: string
          schema_version?: number
          value?: Json
          value_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "working_copy_checkpoints_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "working_copy_checkpoints_restored_from_org_id_fkey"
            columns: ["restored_from", "org_id"]
            isOneToOne: false
            referencedRelation: "working_copy_checkpoints"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "working_copy_checkpoints_room_id_org_id_fkey"
            columns: ["room_id", "org_id"]
            isOneToOne: false
            referencedRelation: "working_copy_rooms"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      working_copy_comments: {
        Row: {
          author_id: string | null
          block_id: string | null
          body: string
          created_at: string
          id: string
          org_id: string
          quote: string | null
          resolved_at: string | null
          resolved_by: string | null
          room_id: string
          thread_id: string
        }
        Insert: {
          author_id?: string | null
          block_id?: string | null
          body: string
          created_at?: string
          id: string
          org_id: string
          quote?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          room_id: string
          thread_id: string
        }
        Update: {
          author_id?: string | null
          block_id?: string | null
          body?: string
          created_at?: string
          id?: string
          org_id?: string
          quote?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          room_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "working_copy_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "working_copy_comments_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "working_copy_comments_room_id_org_id_fkey"
            columns: ["room_id", "org_id"]
            isOneToOne: false
            referencedRelation: "working_copy_rooms"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "working_copy_comments_thread_id_org_id_fkey"
            columns: ["thread_id", "org_id"]
            isOneToOne: false
            referencedRelation: "working_copy_comments"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      working_copy_messages: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          org_id: string
          room_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id: string
          org_id: string
          room_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          org_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "working_copy_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "working_copy_messages_room_id_org_id_fkey"
            columns: ["room_id", "org_id"]
            isOneToOne: false
            referencedRelation: "working_copy_rooms"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      working_copy_rooms: {
        Row: {
          created_at: string
          document_id: string | null
          id: string
          org_id: string
          revision: number
          saved_hash: string
          schema_version: number
          state: string
          state_revision: number
          template_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          id: string
          org_id: string
          revision?: number
          saved_hash: string
          schema_version?: number
          state: string
          state_revision?: number
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          id?: string
          org_id?: string
          revision?: number
          saved_hash?: string
          schema_version?: number
          state?: string
          state_revision?: number
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "working_copy_rooms_document_id_org_id_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "working_copy_rooms_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "working_copy_rooms_template_id_org_id_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "working_copy_rooms_template_id_org_id_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "published_document_templates"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      working_copy_updates: {
        Row: {
          actor_user_id: string | null
          created_at: string
          org_id: string
          revision: number
          room_id: string
          update: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          org_id: string
          revision: number
          room_id: string
          update: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          org_id?: string
          revision?: number
          room_id?: string
          update?: string
        }
        Relationships: [
          {
            foreignKeyName: "working_copy_updates_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "working_copy_updates_room_id_org_id_fkey"
            columns: ["room_id", "org_id"]
            isOneToOne: false
            referencedRelation: "working_copy_rooms"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
    }
    Views: {
      published_document_templates: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          category: string | null
          content: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string | null
          org_id: string | null
          published_at: string | null
          published_by: string | null
          published_revision: number | null
          revision: number | null
          status: string | null
          title: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_template_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_published_version_fkey"
            columns: ["org_id", "id", "published_revision"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["org_id", "template_id", "revision"]
          },
          {
            foreignKeyName: "document_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_organization_invite: {
        Args: {
          target_invite_id: string
          target_token: string
          target_user_email: string
          target_user_id: string
        }
        Returns: string
      }
      allocate_internal_submission_file: {
        Args: {
          target_actor_user_id: string
          target_byte_size: number
          target_content_type: string
          target_expected_checksum_sha256: string
          target_expected_revision: number
          target_field_key: string
          target_file_id: string
          target_org_id: string
          target_original_filename: string
          target_safe_filename: string
          target_storage_key: string
          target_submission_id: string
        }
        Returns: {
          available_at: string | null
          byte_size: number
          checksum_sha256: string | null
          cleanup_after: string
          content_type: string
          created_at: string
          expected_checksum_sha256: string | null
          field_key: string
          id: string
          org_id: string
          original_filename: string
          safe_filename: string
          status: string
          storage_cleaned_at: string | null
          storage_key: string
          submission_id: string
          superseded_at: string | null
          superseded_by: string | null
          updated_at: string
          uploaded_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "submission_files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      append_working_copy_update: {
        Args: {
          expected_revision: number
          saved_hash?: string
          saved_working_copy?: Json
          target_actor_user_id: string
          target_org_id: string
          target_room_id: string
          target_update: string
        }
        Returns: number
      }
      archive_document: {
        Args: {
          target_actor_user_id: string
          target_document_id: string
          target_org_id: string
        }
        Returns: boolean
      }
      archive_folder: {
        Args: {
          target_actor_user_id: string
          target_folder_id: string
          target_org_id: string
        }
        Returns: boolean
      }
      archive_organization_role: {
        Args: {
          target_actor_user_id: string
          target_org_id: string
          target_role_definition_id: string
        }
        Returns: string
      }
      assert_internal_submission_actor: {
        Args: { target_actor_user_id: string; target_org_id: string }
        Returns: Database["public"]["Enums"]["organization_role"]
      }
      assert_internal_submission_review_manager: {
        Args: { target_actor_user_id: string; target_org_id: string }
        Returns: Database["public"]["Enums"]["organization_role"]
      }
      assign_internal_submission: {
        Args: {
          target_actor_user_id: string
          target_assignee_user_id: string
          target_expected_revision: number
          target_org_id: string
          target_submission_id: string
        }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          public_draft_token: string | null
          public_form_link_id: string | null
          required_approvals: number | null
          revision: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_document_signing: {
        Args: { target_document_id: string; target_org_id: string }
        Returns: {
          email: string
          id: string
          name: string
          status: string
        }[]
      }
      compact_working_copy_room: {
        Args: {
          target_org_id: string
          target_room_id: string
          target_state: string
          target_state_revision: number
        }
        Returns: boolean
      }
      complete_document_recipient_signature: {
        Args: {
          target_consented?: boolean
          target_document_id: string
          target_expected_values?: Json
          target_initials_data: Json
          target_ip?: string
          target_org_id: string
          target_recipient_id: string
          target_signature_data: Json
          target_token_hash: string
          target_values: Json
        }
        Returns: string
      }
      complete_document_version: {
        Args: {
          target_actor_user_id: string
          target_document_id: string
          target_org_id: string
          target_version_id: string
        }
        Returns: boolean
      }
      complete_internal_submission_file: {
        Args: {
          target_actor_user_id: string
          target_byte_size: number
          target_checksum_sha256: string
          target_content_type: string
          target_file_id: string
          target_org_id: string
          target_storage_key: string
          target_submission_id: string
        }
        Returns: {
          available_at: string | null
          byte_size: number
          checksum_sha256: string | null
          cleanup_after: string
          content_type: string
          created_at: string
          expected_checksum_sha256: string | null
          field_key: string
          id: string
          org_id: string
          original_filename: string
          safe_filename: string
          status: string
          storage_cleaned_at: string | null
          storage_key: string
          submission_id: string
          superseded_at: string | null
          superseded_by: string | null
          updated_at: string
          uploaded_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "submission_files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_resource_purge_object: {
        Args: { target_lease_token: string; target_object_id: string }
        Returns: boolean
      }
      create_document_comment: {
        Args: {
          target_actor_user_id: string
          target_body: string
          target_comment_id: string
          target_document_id: string
          target_org_id: string
        }
        Returns: string
      }
      create_internal_submission_comment: {
        Args: {
          target_actor_user_id: string
          target_body: string
          target_comment_id: string
          target_org_id: string
          target_submission_id: string
        }
        Returns: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          submission_id: string
        }
        SetofOptions: {
          from: "*"
          to: "submission_comments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_internal_submission_draft: {
        Args: {
          target_actor_user_id: string
          target_org_id: string
          target_submission_id: string
          target_template_id: string
          target_title: string
        }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          public_draft_token: string | null
          public_form_link_id: string | null
          required_approvals: number | null
          revision: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_pending_document_version: {
        Args: {
          target_byte_size: number
          target_checksum_sha256: string
          target_content_type: string
          target_document_id: string
          target_org_id: string
          target_original_filename: string
          target_storage_key: string
          target_upload_authorization_expires_at?: string
          target_uploaded_by: string
          target_version_id: string
        }
        Returns: string
      }
      decide_submission_suggestion: {
        Args: {
          target_accept: boolean
          target_actor_user_id: string
          target_org_id: string
          target_submission_id: string
          target_suggestion_id: string
        }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          public_draft_token: string | null
          public_form_link_id: string | null
          required_approvals: number | null
          revision: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decline_document_signing: {
        Args: {
          target_document_id: string
          target_org_id: string
          target_reason: string
          target_recipient_id: string
          target_token_hash: string
        }
        Returns: {
          email: string
          id: string
          name: string
          status: string
        }[]
      }
      dismiss_submission_changes_request: {
        Args: {
          target_actor_user_id: string
          target_also_approve: boolean
          target_comment: string
          target_expected_revision: number
          target_org_id: string
          target_reviewer_user_id: string
          target_submission_id: string
        }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          public_draft_token: string | null
          public_form_link_id: string | null
          required_approvals: number | null
          revision: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      document_card_contents: {
        Args: { document_ids: string[]; target_org_id: string }
        Returns: {
          content: Json
          id: string
        }[]
      }
      document_template_card_contents: {
        Args: {
          published_only?: boolean
          target_org_id: string
          template_ids: string[]
        }
        Returns: {
          content: Json
          id: string
        }[]
      }
      editable_template_ids: {
        Args: { target_actor_user_id: string; target_org_id: string }
        Returns: string[]
      }
      enqueue_due_resource_purges: {
        Args: { target_limit: number }
        Returns: number
      }
      expire_abandoned_submission_files: {
        Args: { target_batch_size: number }
        Returns: Json
      }
      fail_resource_purge_object: {
        Args: {
          target_error_code: string
          target_lease_token: string
          target_object_id: string
        }
        Returns: string
      }
      finalize_ready_resource_purges: {
        Args: { target_limit: number }
        Returns: number
      }
      get_current_organization_context: {
        Args: { target_user_id: string }
        Returns: {
          membership_created_at: string
          membership_id: string
          membership_updated_at: string
          org_id: string
          organization_created_at: string
          organization_created_by: string
          organization_name: string
          organization_slug: string
          organization_updated_at: string
          role: string
          role_definition_id: string
          role_definition_name: string
          role_definition_permissions: string[]
          role_definition_system_key: string
          status: string
          user_id: string
          workspace_display_name: string
        }[]
      }
      get_document_access_level: {
        Args: {
          target_actor_user_id: string
          target_document_id: string
          target_org_id: string
        }
        Returns: Database["public"]["Enums"]["resource_access_level"]
      }
      get_document_access_levels: {
        Args: {
          target_actor_user_id: string
          target_document_ids: string[]
          target_org_id: string
        }
        Returns: {
          access_level: Database["public"]["Enums"]["resource_access_level"]
          document_id: string
        }[]
      }
      get_folder_access_level: {
        Args: {
          target_actor_user_id: string
          target_folder_id: string
          target_org_id: string
        }
        Returns: Database["public"]["Enums"]["resource_access_level"]
      }
      get_folder_access_levels: {
        Args: {
          target_actor_user_id: string
          target_folder_ids: string[]
          target_org_id: string
        }
        Returns: {
          access_level: Database["public"]["Enums"]["resource_access_level"]
          folder_id: string
        }[]
      }
      get_resource_purge_schema_contract: {
        Args: never
        Returns: {
          object_kind: string
          object_name: string
          present: boolean
          rls_enabled: boolean
          rls_forced: boolean
        }[]
      }
      get_template_access_level: {
        Args: {
          target_actor_user_id: string
          target_org_id: string
          target_template_id: string
        }
        Returns: Database["public"]["Enums"]["template_access_level"]
      }
      hidden_template_ids: {
        Args: { target_actor_user_id: string; target_org_id: string }
        Returns: string[]
      }
      lease_resource_purge_objects: {
        Args: { target_lease_seconds: number; target_limit: number }
        Returns: {
          attempt_count: number
          job_id: string
          lease_token: string
          object_id: string
          storage_key: string
        }[]
      }
      list_unfinalized_generated_documents: {
        Args: { target_limit: number }
        Returns: {
          created_by: string
          document_id: string
          org_id: string
        }[]
      }
      list_workspace_documents: {
        Args: {
          after_document_id: string
          row_limit: number
          target_actor_user_id: string
          target_folder_ids: string[]
          target_include_root: boolean
          target_lifecycle_states: Database["public"]["Enums"]["resource_lifecycle_state"][]
          target_org_id: string
          target_query: string
          target_visible_folder_ids: string[]
        }
        Returns: {
          access_level: Database["public"]["Enums"]["resource_access_level"]
          document: Json
        }[]
      }
      lock_editable_internal_submission: {
        Args: {
          target_actor_user_id: string
          target_org_id: string
          target_submission_id: string
        }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          public_draft_token: string | null
          public_form_link_id: string | null
          required_approvals: number | null
          revision: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_internal_submission_file_storage_cleaned: {
        Args: { target_file_id: string; target_storage_key: string }
        Returns: {
          available_at: string | null
          byte_size: number
          checksum_sha256: string | null
          cleanup_after: string
          content_type: string
          created_at: string
          expected_checksum_sha256: string | null
          field_key: string
          id: string
          org_id: string
          original_filename: string
          safe_filename: string
          status: string
          storage_cleaned_at: string | null
          storage_key: string
          submission_id: string
          superseded_at: string | null
          superseded_by: string | null
          updated_at: string
          uploaded_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "submission_files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      merge_generated_document_answers: {
        Args: {
          target_document_id: string
          target_expected_values?: Json
          target_org_id: string
          target_values: Json
        }
        Returns: Json
      }
      prepare_generated_document_finalization: {
        Args: {
          target_created_by: string
          target_document_id: string
          target_finalization_id: string
          target_org_id: string
          target_render_input_sha256: string
          target_storage_key: string
        }
        Returns: {
          byte_size: number
          created_at: string
          document_version_id: string
          id: string
          pdf_sha256: string
          render_input_sha256: string
          status: string
          storage_key: string
        }[]
      }
      promote_generated_document_finalization: {
        Args: {
          target_byte_size: number
          target_document_id: string
          target_finalization_id: string
          target_finalized_by: string
          target_org_id: string
          target_original_filename: string
          target_pdf_sha256: string
        }
        Returns: string
      }
      purge_due_trashed_document_templates: {
        Args: { target_limit: number }
        Returns: number
      }
      purge_trashed_document_template: {
        Args: {
          target_actor_user_id: string
          target_confirmation_title: string
          target_org_id: string
          target_template_id: string
        }
        Returns: undefined
      }
      record_internal_submission_file_upload_window: {
        Args: {
          target_actor_user_id: string
          target_cleanup_after: string
          target_file_id: string
          target_org_id: string
          target_submission_id: string
        }
        Returns: {
          available_at: string | null
          byte_size: number
          checksum_sha256: string | null
          cleanup_after: string
          content_type: string
          created_at: string
          expected_checksum_sha256: string | null
          field_key: string
          id: string
          org_id: string
          original_filename: string
          safe_filename: string
          status: string
          storage_cleaned_at: string | null
          storage_key: string
          submission_id: string
          superseded_at: string | null
          superseded_by: string | null
          updated_at: string
          uploaded_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "submission_files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_document_version_upload_authorization: {
        Args: {
          target_document_id: string
          target_expires_at: string
          target_org_id: string
          target_uploaded_by: string
          target_version_id: string
        }
        Returns: boolean
      }
      request_document_purge: {
        Args: {
          target_actor_user_id: string
          target_confirmation_title: string
          target_document_id: string
          target_job_id: string
          target_org_id: string
        }
        Returns: string
      }
      request_folder_purge: {
        Args: {
          target_actor_user_id: string
          target_confirmation_name: string
          target_folder_id: string
          target_job_id: string
          target_org_id: string
        }
        Returns: string
      }
      restore_document: {
        Args: {
          target_actor_user_id: string
          target_document_id: string
          target_org_id: string
        }
        Returns: boolean
      }
      restore_folder: {
        Args: {
          target_actor_user_id: string
          target_folder_id: string
          target_org_id: string
        }
        Returns: boolean
      }
      save_internal_submission_draft: {
        Args: {
          target_actor_user_id: string
          target_expected_revision: number
          target_org_id: string
          target_submission_id: string
          target_values: Json
        }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          public_draft_token: string | null
          public_form_link_id: string | null
          required_approvals: number | null
          revision: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_submission_reviewers: {
        Args: {
          target_actor_user_id: string
          target_expected_revision: number
          target_org_id: string
          target_required_approvals: number
          target_reviewer_ids: string[]
          target_submission_id: string
        }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          public_draft_token: string | null
          public_form_link_id: string | null
          required_approvals: number | null
          revision: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_submission_sharing: {
        Args: {
          target_actor_user_id: string
          target_org_id: string
          target_submission_id: string
          target_user_ids: string[]
        }
        Returns: string[]
      }
      start_public_form_draft: {
        Args: {
          target_created_at: string
          target_public_draft_token: string
          target_public_form_token: string
          target_submission_id: string
          target_template_revision: number
          target_title: string
          target_values: Json
        }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          public_draft_token: string | null
          public_form_link_id: string | null
          required_approvals: number | null
          revision: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_internal_submission: {
        Args: {
          target_actor_user_id: string
          target_expected_revision: number
          target_org_id: string
          target_submission_id: string
          target_values: Json
        }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          public_draft_token: string | null
          public_form_link_id: string | null
          required_approvals: number | null
          revision: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_public_form_entry: {
        Args: {
          target_expected_revision: number
          target_public_draft_token: string
          target_public_form_token: string
          target_submission_id: string
          target_submitted_at: string
          target_template_id: string
          target_template_revision: number
          target_template_snapshot: Json
          target_title: string
          target_values: Json
        }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          public_draft_token: string | null
          public_form_link_id: string | null
          required_approvals: number | null
          revision: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      suggest_submission_answers: {
        Args: {
          target_actor_user_id: string
          target_org_id: string
          target_submission_id: string
          target_values: Json
        }
        Returns: number
      }
      supersede_internal_submission_file: {
        Args: {
          target_actor_user_id: string
          target_file_id: string
          target_org_id: string
          target_submission_id: string
        }
        Returns: {
          available_at: string | null
          byte_size: number
          checksum_sha256: string | null
          cleanup_after: string
          content_type: string
          created_at: string
          expected_checksum_sha256: string | null
          field_key: string
          id: string
          org_id: string
          original_filename: string
          safe_filename: string
          status: string
          storage_cleaned_at: string | null
          storage_key: string
          submission_id: string
          superseded_at: string | null
          superseded_by: string | null
          updated_at: string
          uploaded_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "submission_files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      supersede_public_submission_file: {
        Args: {
          target_file_id: string
          target_public_draft_token: string
          target_public_form_token: string
        }
        Returns: {
          available_at: string | null
          byte_size: number
          checksum_sha256: string | null
          cleanup_after: string
          content_type: string
          created_at: string
          expected_checksum_sha256: string | null
          field_key: string
          id: string
          org_id: string
          original_filename: string
          safe_filename: string
          status: string
          storage_cleaned_at: string | null
          storage_key: string
          submission_id: string
          superseded_at: string | null
          superseded_by: string | null
          updated_at: string
          uploaded_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "submission_files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transition_internal_submission: {
        Args: {
          target_actor_user_id: string
          target_comment: string
          target_expected_revision: number
          target_org_id: string
          target_submission_id: string
          target_transition: string
        }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          public_draft_token: string | null
          public_form_link_id: string | null
          required_approvals: number | null
          revision: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_revision: number
          template_snapshot: Json
          title: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      trash_document: {
        Args: {
          target_actor_user_id: string
          target_document_id: string
          target_org_id: string
          target_trash_operation_id: string
        }
        Returns: boolean
      }
      trash_folder: {
        Args: {
          target_actor_user_id: string
          target_folder_id: string
          target_org_id: string
          target_trash_operation_id: string
        }
        Returns: boolean
      }
      update_organization_member_access: {
        Args: {
          target_actor_user_id: string
          target_membership_id: string
          target_org_id: string
          target_role_definition_id: string
          target_workspace_display_name: string
        }
        Returns: string
      }
      validate_internal_submission_values: {
        Args: { target_template_snapshot: Json; target_values: Json }
        Returns: undefined
      }
    }
    Enums: {
      invite_status: "pending" | "accepted" | "revoked" | "expired"
      membership_status: "active" | "disabled"
      organization_role:
        | "owner_admin"
        | "manager"
        | "staff"
        | "external_reviewer"
      resource_access_level: "viewer" | "contributor"
      resource_lifecycle_state:
        | "active"
        | "archived"
        | "trashed"
        | "purge_pending"
      template_access_level: "viewer" | "user" | "editor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      invite_status: ["pending", "accepted", "revoked", "expired"],
      membership_status: ["active", "disabled"],
      organization_role: [
        "owner_admin",
        "manager",
        "staff",
        "external_reviewer",
      ],
      resource_access_level: ["viewer", "contributor"],
      resource_lifecycle_state: [
        "active",
        "archived",
        "trashed",
        "purge_pending",
      ],
      template_access_level: ["viewer", "user", "editor"],
    },
  },
} as const

