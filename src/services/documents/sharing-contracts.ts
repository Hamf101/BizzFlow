import type { OrganizationRole } from "@/lib/permissions"
import type { TemplateAccessLevel } from "@/lib/supabase/admin"
import type {
  DocumentAuditLogInput,
  DocumentServiceClient,
} from "@/services/documents/contracts"
import type { OrganizationMember } from "@/types/organization"
import type { DocumentAccessLevel } from "@/types/document"

/** What can be shared: a document, a folder or a template. */
export type SharingResource = { id: string; kind: "document" | "folder" | "template" }

/** Documents and folders are viewed or edited; a template is viewed, used, or edited. */
export type SharingLevel = DocumentAccessLevel | TemplateAccessLevel

export type SharingInput = {
  actorUserId: string
  organizationId: string
  resource: SharingResource
}

/** Someone, everyone who holds a role, or someone outside the workspace by email. */
export type SharingPrincipal = { userId: string } | { role: OrganizationRole } | { email: string }

/** Several items at once. */
export type SharingManyInput = {
  actorUserId: string
  organizationId: string
  resources: SharingResource[]
}

export type SetSharingAccessInput = SharingInput & {
  /** Null takes the access away. */
  level: SharingLevel | null
  principal: SharingPrincipal
}

export type SetSharingInheritanceInput = SharingInput & {
  /** Whether it also takes in what the folders above it are shared with. */
  inherit: boolean
}

/** A person as the Share dialog names them. */
export type SharingPerson = {
  email: string
  name: string
  role: OrganizationRole
  userId: string
}

/** Access someone was given on this item itself. */
export type SharingGrant =
  | { kind: "person"; level: SharingLevel; mixed?: boolean; person: SharingPerson }
  | { kind: "role"; level: SharingLevel; mixed?: boolean; role: OrganizationRole }

/** Someone outside the workspace given this document: invited until they accept. */
export type SharingGuest = {
  email: string
  joined: boolean
  level: SharingLevel
}

/** Access that arrives from a folder above, which cannot be changed here. */
export type SharingInherited = {
  from: string
  label: string
  level: SharingLevel
}

/** Everything the Share dialog shows. */
export type SharingView = {
  /** Whether it also takes in what the folders above it are shared with. */
  inherit: boolean
  inherited: SharingInherited[]
  /** Everyone in the workspace, for choosing who to add. */
  members: SharingPerson[]
  name: string
  /** The person who made it; they can always edit it. */
  owner: SharingPerson | null
  /** The folder it sits in, or null at the top. */
  parent: { id: string; name: string } | null
  grants: SharingGrant[]
  /** People outside the workspace; only documents have them. */
  guests: SharingGuest[]
  /**
   * What someone outside the workspace may be given here: nothing for folders,
   * templates or several items at once, view only for an uploaded file.
   */
  outsideLevels: SharingLevel[]
}

/** Word for the person a document or folder was just shared with. */
export type SharingNotice = {
  actorName: string
  /** How many items were shared in one go; absent for one. */
  count?: number
  level: SharingLevel
  recipientUserId: string
  resource: SharingResource
  resourceName: string
}

/** The email that invites someone outside the workspace to one document. */
export type GuestInvite = {
  documentTitle: string
  grantId: string
  inviterName: string
  organizationName: string
  recipientEmail: string
  token: string
}

export type SharingServiceDeps = {
  client?: DocumentServiceClient
  createId?: () => string
  /** A fresh secret for an invite link. */
  createToken?: () => string
  /** Emails an invite; a failure takes the invite back. */
  inviteGuest?: (invite: GuestInvite) => Promise<void>
  now?: () => Date
  /** Everyone in the workspace, with names. Defaults to the people service. */
  listMembers?: (organizationId: string, actorUserId: string) => Promise<OrganizationMember[]>
  /** Tells someone it was shared with them. A failure never undoes the share. */
  notify?: (notice: SharingNotice) => Promise<void>
  recordAuditLog?: (input: DocumentAuditLogInput) => Promise<unknown>
}
