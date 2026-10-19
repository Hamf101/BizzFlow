"use client"

import { Check } from "lucide-react"
import Link from "next/link"
import { type ReactElement, useState } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type OnboardingStep = {
  id: string
  title: string
  completed: boolean
  href: string
  actionText: string
}

/** One starter form, as the kind-of-work picker previews it. */
export type StarterPreview = { category: string; title: string }

// The logo's page in four pieces, one filled for each step done.
const FACETS = [
  "M-180 -230H90L-40 -60L-180 0Z",
  "M90 -230L180 -140L180 60L-40 -60Z",
  "M-180 0L-40 -60L60 40L-90 120L-180 230Z",
  "M-180 230L-90 120L60 40L180 60L180 230Z",
]
const FACET_FILLS = ["var(--fold-lavender)", "var(--fold-lilac)", "var(--fold-orchid)", "var(--fold-periwinkle)"]

/**
 * Setting up, done where it is shown: each step opens here with what it
 * needs, the first one not yet done to begin with. Picking a kind of work
 * shows the forms it brings before they are added, and the logo's page fills
 * in a piece for every step done.
 *
 * @param props - The steps, the starter forms by kind of work, and the actions that add them.
 * @returns The getting started card.
 */
export function OnboardingChecklist({
  businessKinds,
  sampleAction,
  sampleActionLabel,
  seedAction,
  starters,
  steps,
}: {
  businessKinds: ReadonlyArray<{ id: string; label: string }>
  sampleAction: () => Promise<void>
  sampleActionLabel: string
  seedAction: (formData: FormData) => Promise<void>
  starters: Readonly<Record<string, readonly StarterPreview[]>>
  steps: OnboardingStep[]
}): ReactElement {
  const done = steps.filter((step) => step.completed).length
  const firstOpen = (): string | undefined => steps.find((step) => !step.completed)?.id ?? steps[0]?.id
  const [openId, setOpenId] = useState(firstOpen)
  // A step finished here hands over to the next one not yet done.
  const [seenDone, setSeenDone] = useState(done)
  if (done !== seenDone) {
    setSeenDone(done)
    setOpenId(firstOpen())
  }
  const [kind, setKind] = useState(businessKinds[0]?.id ?? "")
  const open = steps.find((step) => step.id === openId) ?? steps[0]
  const cards = starters[kind] ?? []

  return (
    <section
      aria-labelledby="getting-started"
      className="grid overflow-hidden rounded-lg border bg-card md:grid-cols-[13rem_minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-4 border-b bg-muted/40 p-5 md:border-r md:border-b-0 md:p-6">
        <div className="flex items-center gap-4 md:flex-col md:items-start">
          <svg
            aria-label={`${done} of ${steps.length} steps done`}
            className="h-14 w-11 shrink-0 md:h-28 md:w-22"
            role="img"
            viewBox="-190 -240 380 480"
          >
            <path d="M-180 -230H90L180 -140V230H-180Z" fill="var(--muted)" />
            {FACETS.map((d, index) => (
              <path
                className="transition-[fill-opacity] duration-700 motion-reduce:transition-none"
                d={d}
                fill={FACET_FILLS[index]}
                fillOpacity={index < done ? 1 : 0}
                key={d}
              />
            ))}
            <path d="M90 -230V-140H180" fill="var(--background)" stroke="var(--primary)" strokeLinejoin="round" strokeWidth="14" />
            <path d="M-180 -230H90L180 -140V230H-180Z" fill="none" stroke="var(--primary)" strokeLinejoin="round" strokeWidth="16" />
          </svg>
          <div>
            <h2 className="text-base font-semibold" id="getting-started">
              Getting started
            </h2>
            <p className="text-sm text-muted-foreground">
              {done} of {steps.length} done
            </p>
          </div>
        </div>
        <ol className="flex flex-wrap gap-1 md:flex-col">
          {steps.map((step, index) => (
            <li key={step.id}>
              <button
                aria-current={step.id === open?.id ? "step" : undefined}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none transition-colors hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring/40",
                  step.id === open?.id && "bg-background font-medium shadow-sm",
                  step.id === open?.id ? "text-foreground" : step.completed ? "text-foreground/80" : "text-muted-foreground"
                )}
                onClick={() => setOpenId(step.id)}
                type="button"
              >
                <span aria-hidden="true" className="grid size-5 place-items-center text-xs tabular-nums">
                  {step.completed ? <Check className="size-4 text-success" /> : index + 1}
                </span>
                {step.title}
                {step.completed ? <span className="sr-only"> (done)</span> : null}
              </button>
            </li>
          ))}
        </ol>
      </div>

      {open ? (
        <div
          className="flex min-w-0 origin-top flex-col gap-5 p-5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-500 md:p-8"
          key={open.id}
        >
          {open.completed ? (
            <>
              <StageHeading title={`${open.title}: done`}>Nothing left to do here.</StageHeading>
              <Link className={cn(buttonVariants({ variant: "outline" }), "w-fit")} href={open.href}>
                {open.actionText}
              </Link>
            </>
          ) : open.id === "template" ? (
            <form action={seedAction} className="flex flex-col gap-5">
              <StageHeading title="Pick the forms your team fills in">
                Start with ones made for your kind of work. You can change every word later.
              </StageHeading>
              <input name="businessKind" type="hidden" value={kind} />
              <div aria-label="Your kind of work" className="flex flex-wrap gap-2" role="group">
                {businessKinds.map((option) => (
                  <button
                    aria-pressed={option.id === kind}
                    className="h-11 rounded-full border bg-background px-4 text-sm text-secondary-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                    key={option.id}
                    onClick={() => setKind(option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <ul aria-label="Forms it adds" className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap" key={kind}>
                {cards.map((card, index) => (
                  <li
                    className="flex flex-col gap-2 rounded-lg border bg-background p-3.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-backwards motion-safe:duration-500 sm:w-44"
                    key={card.title}
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                    <span aria-hidden="true" className="h-1 w-7 rounded-full bg-primary" />
                    <span className="min-h-10 text-sm leading-snug font-medium">{card.title}</span>
                    <span aria-hidden="true" className="h-5 rounded-sm border bg-card" />
                    <span aria-hidden="true" className="h-5 rounded-sm border bg-card" />
                    <span className="text-xs text-muted-foreground">{card.category}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Add {cards.length === 1 ? "this form" : `these ${cards.length} forms`}</Button>
                <Link className={buttonVariants({ variant: "ghost" })} href={open.href}>
                  Start from a blank page instead
                </Link>
              </div>
            </form>
          ) : open.id === "submission" ? (
            <>
              <StageHeading title="Get your first answers">
                Fill one in yourself to see what your team will see, or send a form&apos;s link from its page.
              </StageHeading>
              <div className="flex flex-wrap gap-2">
                <Link className={buttonVariants()} href="/submissions/new">
                  Fill one in myself
                </Link>
                <Link className={buttonVariants({ variant: "outline" })} href="/templates">
                  Send a form link
                </Link>
                <form action={sampleAction}>
                  <Button type="submit" variant="ghost">
                    {sampleActionLabel}
                  </Button>
                </form>
              </div>
            </>
          ) : (
            <>
              <StageHeading title={open.title}>
                {open.id === "people"
                  ? "Bring in the people who fill in, review and sign. Each gets a role you choose."
                  : "Your workspace is ready."}
              </StageHeading>
              <Link className={cn(buttonVariants(), "w-fit")} href={open.href}>
                {open.actionText}
              </Link>
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}

function StageHeading({ children, title }: { children: string; title: string }): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xl font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="max-w-prose text-sm text-muted-foreground">{children}</p>
    </div>
  )
}
