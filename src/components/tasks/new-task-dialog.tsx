"use client"

import { Plus } from "lucide-react"
import type { ReactElement } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { DateTimePicker } from "@/components/ui/date-picker"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { OrganizationMember } from "@/types/organization"

/**
 * Opens the new-task form in a dialog, like People's invite, so the list
 * itself stays quiet.
 *
 * @param props - Whether the actor may assign, who they may assign to, and the create action.
 * @returns The New task button and its dialog.
 */
export function NewTaskDialog({
  canAssign,
  createTaskAction,
  members,
}: {
  canAssign: boolean
  createTaskAction: (formData: FormData) => Promise<void>
  members: readonly OrganizationMember[]
}): ReactElement {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button className="h-11 rounded-[12px] px-4 font-normal" type="button">
            <Plus aria-hidden="true" data-icon="inline-start" />
            <span className="max-sm:sr-only">New task</span>
          </Button>
        }
      />
      <DialogContent className="max-w-lg gap-4 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="font-medium">New task</DialogTitle>
          <DialogDescription className="sr-only">
            Create a task and, optionally, give it a due date and an assignee.
          </DialogDescription>
        </DialogHeader>
        <form action={createTaskAction} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="new-task-title">Title</FieldLabel>
            <Input id="new-task-title" maxLength={200} name="title" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-task-description">Description</FieldLabel>
            <Textarea
              id="new-task-description"
              maxLength={5_000}
              name="description"
            />
          </Field>
          <div className="flex flex-col gap-4 sm:flex-row">
            <Field className="sm:flex-1">
              <FieldLabel htmlFor="new-task-due">Due (UTC)</FieldLabel>
              <DateTimePicker id="new-task-due" name="dueAt" />
            </Field>
            {canAssign ? (
              <Field className="sm:flex-1">
                <FieldLabel htmlFor="new-task-assignee">Assignee</FieldLabel>
                <Select defaultValue="" id="new-task-assignee" name="assignedTo">
                  <option value="">Unassigned</option>
                  {members.map((member: OrganizationMember) => (
                    <option key={member.id} value={member.userId}>
                      {member.fullName?.trim() || member.email}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          <Button className="w-fit" type="submit">
            Create task
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
