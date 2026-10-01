/**
 * Extracts the client IP from the header the deployment's reverse proxy sets.
 *
 * Which header and how many proxies to trust depend on the host, so both are
 * configuration rather than a guess:
 *
 * - `CLIENT_IP_HEADER` (default `x-forwarded-for`): e.g. `cf-connecting-ip`,
 *   `x-real-ip`, `fly-client-ip`, whatever the edge in front of the app sets.
 * - `TRUSTED_PROXY_COUNT` (default `1`): how many proxies append to that header
 *   before it reaches the app. The client's address is that many entries from
 *   the right; anything further left was written by the client and is ignored.
 *
 * Running with no proxy that overwrites or appends the header lets any caller
 * pick their own address, which defeats every per-IP limit.
 *
 * @param headers - Incoming request headers.
 * @returns The client IP, or `"unknown"` when the header is missing or too short.
 */
export function getClientIp(headers: Headers): string {
  const name = process.env.CLIENT_IP_HEADER?.trim() || "x-forwarded-for"
  const trusted = Number.parseInt(process.env.TRUSTED_PROXY_COUNT ?? "", 10)
  const fromRight = trusted >= 1 ? trusted : 1
  const entries = (headers.get(name) ?? "")
    .split(",")
    .map((entry: string): string => entry.trim())
    .filter((entry: string): boolean => entry.length > 0)

  return entries[entries.length - fromRight] ?? "unknown"
}
