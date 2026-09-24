"use client"

import { ChevronDown } from "lucide-react"
import {
  Children,
  type ChangeEvent,
  type ComponentProps,
  isValidElement,
  lazy,
  type ReactElement,
  type ReactNode,
  Suspense,
  useRef,
  useState,
} from "react"

import { cn } from "@/lib/utils"

/** One `<option>` of a select, as read from its children. */
export type Choice = { disabled: boolean; label: ReactNode; value: string }

/** A button drawn as a field, for controls that open a list or calendar of their own. */
export const FIELD_BUTTON_CLASS_NAME =
  "flex h-11 w-full items-center justify-between gap-2 rounded-[8px] border border-input bg-card px-2.5 py-1 text-left text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-popup-open:border-ring md:h-8 md:text-sm"

/** What a select takes: a native select's attributes and `<option>` children. */
export type SelectProps = Pick<
  ComponentProps<"select">,
  "aria-describedby" | "aria-invalid" | "aria-label" | "children" | "className" | "disabled" | "id" | "name" | "required"
> & {
  "data-slot"?: string
  defaultValue?: number | string
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void
  value?: number | string
}

const loadMenu = () => import("@/components/ui/select-menu")
const SelectMenu = lazy(loadMenu)

/**
 * A select drawn in the app's own colours, light and dark, instead of the
 * platform's menu. It takes `<option>` children and reports changes the way a
 * native select does, and a hidden input carries its value when a form posts.
 *
 * Until someone reaches for it, it is only its face, and the menu's code loads
 * then, or sooner on hover or focus; a page that just shows a select, such as
 * a client's public form, stays light. Height is mobile-first — 44px below
 * `md`, the designed 32px above — matching the pattern in `input.tsx`.
 *
 * @param props - Select attributes and `<option>` children.
 * @returns A themed select.
 */
export function Select(props: SelectProps): ReactElement {
  const [reached, setReached] = useState(false)
  const choices = readChoices(props.children)
  // Like a native select, one left to itself starts on its first choice.
  const current = String(props.value ?? props.defaultValue ?? choices.find((choice) => !choice.disabled)?.value ?? "")
  const face = (
    <FieldFace
      aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]}
      aria-label={props["aria-label"]}
      className={props.className}
      data-slot={props["data-slot"] ?? "select"}
      disabled={props.disabled}
      haspopup="listbox"
      icon={<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
      id={props.id}
      label={choices.find((choice) => choice.value === current)?.label}
      name={props.name}
      onReach={() => setReached(true)}
      onWarm={() => void loadMenu()}
      placeholder={current === ""}
      required={props.required}
      value={current}
    />
  )

  return reached ? (
    <Suspense fallback={face}>
      <SelectMenu {...props} defaultOpen />
    </Suspense>
  ) : (
    face
  )
}

/**
 * A field that opens a menu or calendar, as it looks before that code has
 * loaded: its value on a field-shaped button, which asks for the menu when
 * pressed or opened from the keyboard, and a hidden input that carries the
 * value into a form meanwhile.
 *
 * @param props - How the field reads and is named, and what reaching for it does.
 * @returns The field's face.
 */
export function FieldFace({
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  "aria-label": ariaLabel,
  className,
  "data-slot": slot,
  disabled,
  haspopup,
  icon,
  id,
  label,
  name,
  onReach,
  onWarm,
  placeholder,
  required,
  value,
}: Pick<SelectProps, "aria-describedby" | "aria-invalid" | "aria-label" | "className" | "data-slot" | "disabled" | "id" | "name" | "required"> & {
  haspopup: "dialog" | "listbox"
  icon: ReactNode
  label: ReactNode
  onReach: () => void
  onWarm: () => void
  placeholder: boolean
  value: string
}): ReactElement {
  const button = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        aria-describedby={describedBy}
        aria-expanded={false}
        aria-haspopup={haspopup}
        aria-invalid={invalid}
        aria-label={ariaLabel}
        className={cn(FIELD_BUTTON_CLASS_NAME, className)}
        data-disabled={disabled ? "" : undefined}
        data-slot={slot}
        disabled={disabled}
        id={id}
        onClick={onReach}
        onFocus={onWarm}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onReach()
          }
        }}
        onPointerEnter={onWarm}
        ref={button}
        // eslint-disable-next-line jsx-a11y/role-has-required-aria-props -- collapsed, it has no list yet to control, which ARIA 1.2 allows
        role="combobox"
        type="button"
      >
        <span className={cn("min-w-0 truncate", placeholder && "text-muted-foreground")}>{label}</span>
        {icon}
      </button>
      {name ? (
        <input
          aria-hidden="true"
          className="sr-only"
          name={name}
          onChange={() => undefined}
          onFocus={() => button.current?.focus()}
          required={required}
          tabIndex={-1}
          value={value}
        />
      ) : null}
    </>
  )
}

// `<option>` children, including those grouped or mapped from arrays.
export function readChoices(children: ReactNode): Choice[] {
  return Children.toArray(children).flatMap((child): Choice[] => {
    if (!isValidElement<{ children?: ReactNode; disabled?: boolean; value?: number | string }>(child)) {
      return []
    }

    if (child.type === "option") {
      return [{ disabled: Boolean(child.props.disabled), label: child.props.children, value: String(child.props.value ?? "") }]
    }

    return readChoices(child.props.children)
  })
}
