"use client"

import { ChevronDown } from "lucide-react"
import { useSyncExternalStore } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { APPROVED_AI_MODELS, flowModelSchema, type FlowModelId } from "@/services/ai/approved-models"

const KEY = "bizflow.flow-model"
const DEFAULT = APPROVED_AI_MODELS[0].model

function isOffered(value: unknown): value is FlowModelId {
  return flowModelSchema.safeParse(value).success
}

const listeners = new Set<() => void>()
// Holds a pick the browser refused to store, so the menu still follows it.
let unstored: FlowModelId | null = null

function readFlowModel(): FlowModelId {
  if (unstored) {
    return unstored
  }

  try {
    const kept = localStorage.getItem(KEY)

    return isOffered(kept) ? kept : DEFAULT
  } catch {
    return DEFAULT
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function pickFlowModel(model: FlowModelId): void {
  try {
    localStorage.setItem(KEY, model)
  } catch {
    unstored = model
  }

  listeners.forEach((listener) => listener())
}

/**
 * The model this person last picked for Flow, remembered on their device.
 * `chosen()` reads it at send time, so a message sent on open goes to the
 * kept pick even before the menu shows it.
 */
export function useFlowModel(): Readonly<{ chosen: () => FlowModelId; model: FlowModelId; pick: (model: FlowModelId) => void }> {
  const model = useSyncExternalStore(subscribe, readFlowModel, () => DEFAULT)

  return { chosen: readFlowModel, model, pick: pickFlowModel }
}

/** A small menu under Flow's message box, naming the model each message goes to. */
export function FlowModelPicker({
  disabled,
  model,
  onChange,
}: Readonly<{ disabled?: boolean; model: FlowModelId; onChange: (model: FlowModelId) => void }>) {
  const label = APPROVED_AI_MODELS.find((candidate) => candidate.model === model)?.label ?? model

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Flow model: ${label}`}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60 md:min-h-8"
        disabled={disabled}
      >
        {label}
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top">
        <DropdownMenuRadioGroup
          onValueChange={(value: unknown) => {
            if (isOffered(value)) {
              onChange(value)
            }
          }}
          value={model}
        >
          {APPROVED_AI_MODELS.map((candidate, index) => (
            <DropdownMenuRadioItem key={candidate.model} value={candidate.model}>
              {candidate.label}
              {index === 0 ? <span className="text-xs text-muted-foreground">Newest</span> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
