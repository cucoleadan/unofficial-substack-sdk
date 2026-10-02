export class SubstackConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubstackConfigurationError'
  }
}

/** One field-level validation problem reported by Substack. */
export interface SubstackApiIssue {
  /** Request part Substack validated, such as `body` or `query`. */
  location?: string
  /** Upstream parameter name, such as `trigger_at` or `attachmentIds`. */
  param?: string
  /** Upstream message, such as `Invalid value`. */
  msg: string
}

/** Parsed, request-free details from an upstream error response. */
export interface SubstackApiErrorDetails {
  /**
   * Substack's human-readable message, such as `Please type a shorter
   * comment`, or a `param: msg` summary of validation issues.
   */
  upstreamMessage?: string
  /** Field-level validation issues without the echoed request values. */
  issues?: SubstackApiIssue[]
}

export class SubstackApiError extends Error {
  readonly upstreamMessage?: string
  readonly issues?: SubstackApiIssue[]

  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    /**
     * Upstream response body, truncated to 500 characters. Validation
     * `value` echoes are removed so request content does not leak into logs.
     */
    readonly detail?: string,
    details: SubstackApiErrorDetails = {}
  ) {
    super(message)
    this.name = 'SubstackApiError'
    if (details.upstreamMessage !== undefined) this.upstreamMessage = details.upstreamMessage
    if (details.issues !== undefined) this.issues = details.issues
  }
}

const MAX_DETAIL_LENGTH = 500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function withoutEchoedValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEchoedValues)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'value')
      .map(([key, entry]) => [key, withoutEchoedValues(entry)])
  )
}

/**
 * Extracts Substack's error message from a failed response body.
 *
 * Substack returns either `{ "error": "...", "type": "single" }` or
 * `{ "errors": [{ location, param, value, msg }] }`. The second shape echoes
 * request input in `value`, which can contain Note text or an entire base64
 * image, so `value` is never retained. Secrets are redacted from the body.
 */
export function parseUpstreamError(
  body: string,
  secrets: readonly string[] = []
): { detail?: string; details: SubstackApiErrorDetails } {
  const redact = (text: string) =>
    secrets.reduce((result, secret) => (secret ? result.split(secret).join('[redacted]') : result), text)

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { detail: redact(body).slice(0, MAX_DETAIL_LENGTH), details: {} }
  }

  const details: SubstackApiErrorDetails = {}
  if (isRecord(parsed)) {
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      details.upstreamMessage = redact(parsed.error.trim())
    }
    if (Array.isArray(parsed.errors)) {
      const issues = parsed.errors
        .filter(isRecord)
        .filter((issue) => typeof issue.msg === 'string')
        .map((issue) => {
          const result: SubstackApiIssue = { msg: redact(issue.msg as string) }
          if (typeof issue.location === 'string') result.location = issue.location
          if (typeof issue.param === 'string') result.param = issue.param
          return result
        })
      if (issues.length > 0) {
        details.issues = issues
        details.upstreamMessage ??= issues
          .map((issue) => (issue.param ? `${issue.param}: ${issue.msg}` : issue.msg))
          .join('; ')
      }
    }
  }

  // Keep the raw body unless an echoed value has to be removed from it.
  const stripped = JSON.stringify(withoutEchoedValues(parsed))
  const detail = stripped === JSON.stringify(parsed) ? body : stripped
  return { detail: redact(detail).slice(0, MAX_DETAIL_LENGTH), details }
}
