"use client"

import {
  type ComponentProps,
  type ReactElement,
  useRef,
  useState,
} from "react"
import { Eye, EyeOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type PasswordInputProps = Omit<ComponentProps<"input">, "ref" | "type">

/**
 * Renders a password field with an accessible eye-only visibility control.
 *
 * @param props - Standard input attributes other than `type` and `ref`.
 * @returns A masked password input that can be revealed without submitting its form.
 */
export function PasswordInput({
  className,
  ...props
}: PasswordInputProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const toggleLabel = isVisible ? "Hide password" : "Show password"

  function toggleVisibility(): void {
    setIsVisible((current) => !current)
    inputRef.current?.focus({ preventScroll: true })
  }

  return (
    <div className="relative" data-slot="password-input">
      <Input
        {...props}
        className={cn("pr-12 md:pr-10", className)}
        ref={inputRef}
        type={isVisible ? "text" : "password"}
      />
      <Button
        aria-label={toggleLabel}
        aria-pressed={isVisible}
        className="absolute inset-y-0 right-0 h-full w-11 rounded-l-none px-0 text-muted-foreground hover:bg-transparent hover:text-foreground active:translate-y-0 md:w-8"
        onClick={toggleVisibility}
        size="icon"
        title={toggleLabel}
        type="button"
        variant="ghost"
      >
        {isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  )
}
