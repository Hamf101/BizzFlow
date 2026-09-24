import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { RolesAndAccessSettings } from "@/components/settings/roles-and-access-settings"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { formatMediumDateTime } from "@/lib/date-format"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import {
  getOrganizationNotificationSettings,
  listNotificationDeliveries,
  type OrganizationNotificationSettings,
} from "@/services/notification-service"
import type { NotificationDelivery } from "@/types/notification"
import {
  getMemberSettings,
  listOrganizationPeople,
  OrganizationServiceError,
  type MemberSettings,
  type OrganizationPeople,
} from "@/services/organization-service"
import {
  archiveOrganizationRoleAction,
  createOrganizationRoleAction,
  updateNotificationPreferencesAction,
  updateOrganizationNotificationSettingsAction,
  updateOrganizationRoleAction,
  updateProfileAction,
} from "./actions"

export default async function SettingsPage(): Promise<ReactElement> {
  const user = await loadAuthenticatedPageUser("/settings")
  const { context, errorMessage: contextErrorMessage } =
    await loadPageOrganizationContext({
      userId: user.id,
      failureEvent: "settings_context_load_failed",
    })

  if (!context) {
    if (contextErrorMessage) {
      return (
        <SettingsShell>
          <Alert variant="destructive">
            <AlertTitle>Supabase setup incomplete</AlertTitle>
            <AlertDescription>{contextErrorMessage}</AlertDescription>
          </Alert>
        </SettingsShell>
      )
    }

    redirect(
      buildFeedbackRedirect("/dashboard", "organization_required")
    )
  }

  const canManageOrganization = canPerformOrganizationAction(
    context.membership,
    "organization:manage"
  )

  let settings: MemberSettings
  let organizationSettings: OrganizationNotificationSettings
  const isOwner = context.membership.role === "owner_admin"

  try {
    ;[settings, organizationSettings] = await Promise.all([
      getMemberSettings({
        actorUserId: user.id,
        organizationId: context.organization.id,
      }),
      getOrganizationNotificationSettings(context.organization.id),
    ])
  } catch (error: unknown) {
    return (
      <SettingsShell>
        <Alert variant="destructive">
          <AlertTitle>Settings unavailable</AlertTitle>
          <AlertDescription>
            {error instanceof OrganizationServiceError
              ? error.message
              : "Unable to load user settings."}
          </AlertDescription>
        </Alert>
      </SettingsShell>
    )
  }

  return (
    <SettingsShell>
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-medium tracking-normal">Settings</h1>
        <p className="text-[13px] text-muted-foreground">
          {context.organization.name}
        </p>
      </section>

      {isOwner ? (
        <RolesAndAccessSection
          actorUserId={user.id}
          organizationId={context.organization.id}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateProfileAction} className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="displayName">Name</FieldLabel>
                <Input
                  id="displayName"
                  name="displayName"
                  defaultValue={settings.displayName ?? ""}
                  placeholder="Jane Doe"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="phoneNumber">Phone</FieldLabel>
                <Input
                  id="phoneNumber"
                  name="phoneNumber"
                  defaultValue={settings.phoneNumber ?? ""}
                  placeholder="+14155552671"
                  type="tel"
                />
              </Field>
              <Button type="submit" variant="outline" className="w-fit">
                Save
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateNotificationPreferencesAction} className="flex flex-col gap-6">
              <input type="hidden" name="organizationId" value={context.organization.id} />
              
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor="emailNotificationsEnabled" className="text-base">Email</FieldLabel>
                </div>
                <Switch
                  id="emailNotificationsEnabled"
                  name="emailNotificationsEnabled"
                  defaultChecked={settings.emailNotificationsEnabled}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor="smsNotificationsEnabled" className="text-base">SMS</FieldLabel>
                </div>
                <Switch
                  id="smsNotificationsEnabled"
                  name="smsNotificationsEnabled"
                  defaultChecked={settings.smsNotificationsEnabled}
                />
              </div>

              <Button type="submit" variant="outline" className="w-fit">
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {canManageOrganization && (
        <Card>
          <CardHeader>
            <CardTitle>Organization notifications</CardTitle>
            <CardDescription>
              Off here silences the channel for everyone, whatever their own
              settings say.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={updateOrganizationNotificationSettingsAction}
              className="flex flex-col gap-6"
            >
              <input
                type="hidden"
                name="organizationId"
                value={context.organization.id}
              />

              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <FieldLabel
                    htmlFor="orgEmailNotificationsEnabled"
                    className="text-base"
                  >
                    Email
                  </FieldLabel>
                </div>
                <Switch
                  id="orgEmailNotificationsEnabled"
                  name="orgEmailNotificationsEnabled"
                  defaultChecked={organizationSettings.emailNotificationsEnabled}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <FieldLabel
                    htmlFor="orgSmsNotificationsEnabled"
                    className="text-base"
                  >
                    SMS
                  </FieldLabel>
                </div>
                <Switch
                  id="orgSmsNotificationsEnabled"
                  name="orgSmsNotificationsEnabled"
                  defaultChecked={organizationSettings.smsNotificationsEnabled}
                />
              </div>

              <Button type="submit" variant="outline" className="w-fit">
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {canManageOrganization && (
        <NotificationActivityCard
          deliveries={await loadRecentDeliveries(context.organization.id)}
        />
      )}
    </SettingsShell>
  )
}

async function RolesAndAccessSection({
  actorUserId,
  organizationId,
}: {
  actorUserId: string
  organizationId: string
}): Promise<ReactElement> {
  let people: OrganizationPeople

  try {
    people = await listOrganizationPeople(actorUserId, organizationId)
  } catch (error: unknown) {
    console.warn("settings_roles_and_access_load_failed", {
      actorUserId,
      organizationId,
      reason: error instanceof Error ? error.message : "Unknown error",
    })

    return (
      <Alert variant="destructive">
        <AlertTitle>Roles and access unavailable</AlertTitle>
        <AlertDescription>
          {error instanceof OrganizationServiceError
            ? error.message
            : "Unable to load workspace roles."}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <RolesAndAccessSettings
      archiveRoleAction={archiveOrganizationRoleAction}
      createRoleAction={createOrganizationRoleAction}
      members={people.members}
      organizationId={organizationId}
      roles={people.roles}
      updateRoleAction={updateOrganizationRoleAction}
    />
  )
}

/**
 * Reads recent delivery attempts, degrading to an empty list on failure.
 *
 * This panel is diagnostic, so an unreadable history must not take the whole
 * settings page down with it.
 */
async function loadRecentDeliveries(
  organizationId: string
): Promise<NotificationDelivery[]> {
  try {
    return await listNotificationDeliveries({ organizationId, limit: 10 })
  } catch (error: unknown) {
    console.warn("settings_notification_history_load_failed", {
      organizationId,
      reason: error instanceof Error ? error.message : "Unknown error",
    })
    return []
  }
}

function NotificationActivityCard({
  deliveries,
}: {
  deliveries: NotificationDelivery[]
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent notification activity</CardTitle>
        <CardDescription>
          The last ten attempts. Message content is never recorded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No notifications have been sent yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {deliveries.map((delivery: NotificationDelivery) => (
              <li
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border px-3 py-2"
                key={delivery.id}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm">
                    {delivery.purpose.replace(/_/g, " ")} ·{" "}
                    {delivery.channel.toUpperCase()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatMediumDateTime(delivery.createdAt)}
                  </span>
                  {delivery.lastError && (
                    <span className="text-xs text-destructive">
                      {delivery.lastError}
                    </span>
                  )}
                </div>
                <Badge
                  variant={
                    delivery.status === "failed"
                      ? "destructive"
                      : delivery.status === "suppressed"
                        ? "outline"
                        : "secondary"
                  }
                >
                  {delivery.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SettingsShell({
  children,
}: {
  children: ReactNode
}): ReactElement {
  // Forms read best at a steady width, however wide the screen.
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      {children}
    </div>
  )
}
