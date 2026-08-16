"use client"

import { CheckCircle2, Circle, Sparkles } from "lucide-react"
import Link from "next/link"
import type { ReactElement } from "react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type OnboardingStep = {
  id: string
  title: string
  description: string
  completed: boolean
  href: string
  actionText: string
}

export function OnboardingChecklist({
  seedAction,
  steps,
}: {
  seedAction?: () => Promise<void>
  steps: OnboardingStep[]
}): ReactElement {
  const completedCount = steps.filter((s) => s.completed).length
  const isAllDone = completedCount === steps.length

  return (
    <Card className="w-full bg-gradient-to-br from-card via-card to-primary/5 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <CardTitle>Getting Started with BizFlow</CardTitle>
          </div>
          <CardDescription>
            Complete these setup tasks to get your organization workflow-ready.
          </CardDescription>
        </div>
        <Badge variant={isAllDone ? "default" : "secondary"}>
          {completedCount} / {steps.length} Completed
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {steps.map((step) => (
            <div
              className={`flex items-start gap-3 rounded-lg border p-3.5 transition-colors ${
                step.completed ? "bg-muted/30 border-muted" : "bg-card border-border"
              }`}
              key={step.id}
            >
              {step.completed ? (
                <CheckCircle2 className="size-5 text-emerald-500 mt-0.5 shrink-0" />
              ) : (
                <Circle className="size-5 text-muted-foreground mt-0.5 shrink-0" />
              )}
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <span
                  className={`text-sm font-medium ${
                    step.completed ? "line-through text-muted-foreground" : "text-foreground"
                  }`}
                >
                  {step.title}
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
                {!step.completed && (
                  <div className="pt-2">
                    <Link
                      className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                      href={step.href}
                    >
                      {step.actionText}
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {seedAction && (
          <form action={seedAction} className="pt-2 flex justify-end">
            <Button size="sm" type="submit" variant="secondary">
              <Sparkles className="mr-1.5 size-3.5" />
              Seed 4 Starter Templates
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
