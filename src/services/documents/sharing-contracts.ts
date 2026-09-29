import type { OrganizationRole } from "@/lib/permissions"
import type {
  DocumentAuditLogInput,
  DocumentServiceClient,
} from "@/services/documents/contracts"
import type { OrganizationMember } from "@/types/organization"
import type { DocumentAccessLevel } from "@/types/document"

/** What can be shared: a document or a folder. */
export type SharingResource = { id: string; kind: "document" | "folder" }

export type SharingInput = {
  actorUserId: string
  organizationId: string
  resource: SharingResource
}

/** Someone, or everyone who holds a role. */
export type SharingPrincipal = { userId: string } | { role: OrganizationRole }

/** Several items at once. */
export type SharingManyInput = {
  actorUserId: string
  organizationId: string
  resources: SharingResource[]
}

export type SetSharingAccessInput = SharingInput & {
  /** Null takes the access away. */
  level: DocumentAccessLevel | null
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
  | { kind: "person"; level: DocumentAccessLevel; mixed?: boolean; person: SharingPerson }
  | { kind: "role"; level: DocumentAccessLevel; mixed?: boolean; role: OrganizationRole }

/** Access that arrives from a folder above, which cannot be changed here. */
export type SharingInherited = {
  from: string
  label: string
  level: DocumentAccessLevel
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
}

/** Word for the person a document or folder was just shared with. */
export type SharingNotice = {
  actorName: string
  /** How many items were shared in one go; absent for one. */
  count?: number
  level: DocumentAccessLevel
  recipientUserId: string
  resource: SharingResource
  resourceName: string
}

export type SharingServiceDeps = {
  client?: DocumentServiceClient
  createId?: () => string
  /** Everyone in the workspace, with names. Defaults to the people service. */
  listMembers?: (organizationId: string, actorUserId: string) => Promise<OrganizationMember[]>
  /** Tells someone it was shared with them. A failure never undoes the share. */
  notify?: (notice: SharingNotice) => Promise<void>
  recordAuditLog?: (input: DocumentAuditLogInput) => Promise<unknown>
}
