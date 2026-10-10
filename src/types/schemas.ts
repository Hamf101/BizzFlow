import { z } from "zod"

/** A row or member id. */
export const uuidSchema = z.string().uuid()

/** An ISO-8601 instant as Postgres returns it, offset included. */
export const timestampSchema = z.string().datetime({ offset: true })
