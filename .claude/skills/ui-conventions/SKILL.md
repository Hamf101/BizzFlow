---
name: ui-conventions
description: >-
  BizFlow UI and shadcn/ui (base-nova) conventions. Use when creating or editing React
  components under src/components or src/app — Tailwind v4 classes, semantic color tokens,
  cn(), cva variants, Base UI primitives, Card/Field composition, icons, and spacing rules.
  Covers the project theme tokens and the do/don't list from the design system.
---

# BizFlow UI conventions

shadcn/ui **`base-nova`** style, base color `neutral`, `cssVariables: true`, RSC on, Lucide
icons. Primitives come from **`@base-ui/react`** (not Radix). Tailwind **v4** (config-less; theme
is CSS variables in `src/app/globals.css`). Utility: `cn()` from `@/lib/utils`.

## Use semantic tokens, never raw palette colors

The theme is defined as CSS variables and exposed as Tailwind classes. Style with the **role**,
not the hue — this keeps light/dark and the plum brand coherent.

| Token | Use for | (light value) |
|---|---|---|
| `bg-background` / `text-foreground` | page surface / text | stone `#f3f1ed` / ink `#252329` |
| `bg-card` / `text-card-foreground` | cards, panels | paper `#fffdfc` |
| `bg-primary` / `text-primary-foreground` | primary actions | plum `#635273` |
| `bg-secondary` / `text-secondary-foreground` | secondary surfaces | vellum `#ece6f3` |
| `bg-muted` / `text-muted-foreground` | subtle bg / secondary text | |
| `bg-accent` / `text-accent-foreground` | hover/active accents | |
| `text-destructive` / `bg-destructive` | errors, destructive actions | `#a24949` |
| `border-border` · `border-input` · `ring-ring` | borders / focus ring | |

**Never** hard-code `bg-white`, `text-black`, `bg-slate-800`, `#hex`, etc. in components. (A
project grep guards against palette classes; keep it clean.) Brand-specific one-offs may use the
`brand-*` tokens (`brand-plum`, `brand-paper`, `brand-ink`, `brand-vellum`, `brand-stone`).

## Component authoring pattern (matches `src/components/ui/button.tsx`)

```tsx
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva("inline-flex items-center justify-center …", {
  variants: { variant: { default: "bg-primary text-primary-foreground …", outline: "border-border bg-card …" },
             size: { default: "h-8 gap-1.5 px-2.5", icon: "size-8" } },
  defaultVariants: { variant: "default", size: "default" },
})

function Button({ className, variant, size, ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
export { Button, buttonVariants }
```

Conventions in that file to copy: `cva` for variants, `cn(...)` to merge incoming `className`
last, a `data-slot="…"` attribute, and SVG sizing handled by the parent
(`[&_svg:not([class*='size-'])]:size-4`) rather than sizing icons inline.

## Rules (from the design system)

- **Reuse first.** Check `src/components/ui/` and feature folders before writing custom UI.
  Compose existing components rather than restyling primitives inline.
- **`cn()`** for every conditional/merged class list. Incoming `className` wins (merge it last).
- **Spacing:** use `gap-*` (fl's/grid), not `space-x/space-y-*`.
- **Square sizes:** `size-8`, not `h-8 w-8`.
- **Cards:** full composition — `Card` › `CardHeader`/`CardTitle`/`CardDescription` ›
  `CardContent` › `CardFooter`. Don't fake a card with a bare `div`.
- **Forms:** `Field` / `FieldLabel` / `FieldGroup` (`src/components/ui/field.tsx`) + `Input`;
  Zod validates on the server (see `writing-services`).
- **Status → `Badge`**, callouts → `Alert`. Reuse `src/lib/page-status-badges.tsx` for
  submission/document statuses instead of re-mapping status→color per screen.
- **Icons:** Lucide, via the icon slot; don't set an explicit size unless overriding the default.
- **Dialogs/Sheets/Drawers** need an accessible title.
- **Mobile-first.** This is a mobile-first product — verify small viewports; no overlapping or
  unreachable controls. Prefer responsive utilities over fixed widths.
- **RSC by default.** Keep components server components unless they need interactivity/hooks;
  add `"use client"` only then, at the smallest boundary.

## Adding a shadcn component

It must be added to the project before import. Inspect/install with the shadcn CLI
(`npx shadcn@latest info` / `add <component>`); registries incl. `@supabase` are in
`components.json`. Don't invent an import path for a component that isn't installed.
