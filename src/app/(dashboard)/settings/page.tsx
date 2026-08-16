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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { formatMediumDateTime } from "@/lib/date-format"
import { buildRedirect } from "@/lib/form-utils"
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
  OrganizationServiceError,
  type MemberSettings,
} from "@/services/organization-service"
import {
  updateNotificationPreferencesAction,
  updateOrganizationNotificationSettingsAction,
  updateProfileAction,
} from "./actions"

type SettingsSearchParams = Promise<{
  error?: string
  message?: string
}>

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: SettingsSearchParams
}): Promise<ReactElement> {
  const params = await searchParams
  const user = await loadAuthenticatedPageUser("/settings")
  const { context, errorMessage: contextErrorMessage } =
    await loadPageOrganizationContext({
      userId: user.id,
      failureEvent: "settings_context_load_failed",
    })

  if (!context) {
    if (contextErrorMessage) {
      return (
        <SettingsShell params={params}>
          <Alert variant="destructive">
            <AlertTitle>Supabase setup incomplete</AlertTitle>
            <AlertDescription>{contextErrorMessage}</AlertDescription>
          </Alert>
        </SettingsShell>
      )
    }

    redirect(
      buildRedirect("/dashboard", {
        error: "Create an organization before managing settings.",
      })
    )
  }

  const canManageOrganization = canPerformOrganizationAction(
    context.membership.role,
    "organization:manage"
  )

  let settings: MemberSettings
  let organizationSettings: OrganizationNotificationSettings

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
      <SettingsShell params={params}>
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
    <SettingsShell params={params}>
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-normal">Settings</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Manage your profile and notification preferences for {context.organization.name}.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Update your personal information.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateProfileAction} className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="displayName">Display Name</FieldLabel>
                <Input
                  id="displayName"
                  name="displayName"
                  defaultValue={settings.displayName ?? ""}
                  placeholder="Jane Doe"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="phoneNumber">Phone Number</FieldLabel>
                <Input
                  id="phoneNumber"
                  name="phoneNumber"
                  defaultValue={settings.phoneNumber ?? ""}
                  placeholder="+14155552671"
                  type="tel"
                />
                <FieldDescription>
                  Include country code (e.g. +14155552671).
                </FieldDescription>
              </Field>
              <Button type="submit" variant="outline" className="w-fit">
                Save profile
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notification Preferences</CardTitle>
            <CardDescription>
              Choose how you want to be notified about tasks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateNotificationPreferencesAction} className="flex flex-col gap-6">
              <input type="hidden" name="organizationId" value={context.organization.id} />
              
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor="emailNotificationsEnabled" className="text-base">Email Notifications</FieldLabel>
                  <FieldDescription>Receive task assignments and reminders via email.</FieldDescription>
                </div>
                <Switch
                  id="emailNotificationsEnabled"
                  name="emailNotificationsEnabled"
                  defaultChecked={settings.emailNotificationsEnabled}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor="smsNotificationsEnabled" className="text-base">SMS Notifications</FieldLabel>
                  <FieldDescription>Receive task assignments and reminders via SMS.</FieldDescription>
                </div>
                <Switch
                  id="smsNotificationsEnabled"
                  name="smsNotificationsEnabled"
                  defaultChecked={settings.smsNotificationsEnabled}
                />
              </div>

              <Button type="submit" variant="outline" className="w-fit">
                Save preferences
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
              Workspace-wide switches for {context.organization.name}. Turning a
              channel off here silences it for every member, whatever their own
              preference says.
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
                    Email for the whole workspace
                  </FieldLabel>
                  <FieldDescription>
                    Allow BizFlow to email any member of this organization.
                  </FieldDescription>
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
                    SMS for the whole workspace
                  </FieldLabel>
                  <FieldDescription>
                    Allow BizFlow to text any member of this organization.
                  </FieldDescription>
                </div>
                <Switch
                  id="orgSmsNotificationsEnabled"
                  name="orgSmsNotificationsEnabled"
                  defaultChecked={organizationSettings.smsNotificationsEnabled}
                />
              </div>

              <Button type="submit" variant="outline" className="w-fit">
                Save organization settings
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
          The last ten delivery attempts. Message content, phone numbers, and
          email addresses are deliberately not recorded.
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
  params,
}: {
  children: ReactNode
  params: Awaited<SettingsSearchParams>
}): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      {params.error && (
        <Alert variant="destructive">
          <AlertTitle>Settings update failed</AlertTitle>
          <AlertDescription>{params.error}</AlertDescription>
        </Alert>
      )}

      {params.message && (
        <Alert>
          <AlertTitle>Settings updated</AlertTitle>
          <AlertDescription>{params.message}</AlertDescription>
        </Alert>
      )}

      {children}
    </div>
  )
}
