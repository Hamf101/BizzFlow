/** One choice in a list's filters or view menu: where it leads and whether it is current. */
export type ListOption = {
  /** Download the target instead of opening it, such as a CSV export. */
  download?: boolean
  href: string
  label: string
  selected: boolean
}

/** A labelled group of choices in a list's view menu. */
export type ListOptionSection = {
  label: string
  options: ListOption[]
}
