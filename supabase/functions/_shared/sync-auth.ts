/** Public by design. Cron sends this. It is not a JWT, so the gateway JWT check stays off. */
export const PUBLISHABLE_KEY = "sb_publishable_B9FtAXbv5ln6lS3P745C_Q__2SXk7vJ";

function bearer(authorization: string | null | undefined): string {
  if (!authorization) return "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

/** True when the request presents the public publishable key (or an injected extra). */
export function callerAllowed(
  apiKey: string | null | undefined,
  authorization: string | null | undefined,
  extraKeys: string[] = [],
): boolean {
  const presented = [apiKey?.trim() ?? "", bearer(authorization)].filter((value) => value.length > 0);
  if (presented.length === 0) return false;
  const allowed = new Set([PUBLISHABLE_KEY, ...extraKeys.map((key) => key.trim()).filter(Boolean)]);
  return presented.some((value) => allowed.has(value));
}
