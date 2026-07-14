export const ACTIVITY_FILTERS = ['all', 'replies-and-mentions', 'restacks'] as const

export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface SubstackClientOptions {
  /** The value of the authenticated Substack session cookie. */
  sessionToken?: string
  /** Legacy alias for sessionToken. */
  token?: string
  /** Publication origin used by publication-scoped endpoints. */
  publicationUrl?: string
  /** Global Substack origin. Defaults to https://substack.com. */
  baseUrl?: string
  /** Legacy alias for baseUrl. */
  substackUrl?: string
  /** API prefix appended to each origin. Defaults to api/v1. */
  urlPrefix?: string
  /** Retained for callers migrating from the legacy SDK. */
  perPage?: number
  /** Retained for callers migrating from the legacy SDK. */
  maxRequestsPerSecond?: number
  sessionCookieName?: string
  fetch?: FetchLike
}

export interface CursorOptions {
  cursor?: string
}

export interface ProfilePostsOptions {
  limit?: number
  offset?: number
}

/** Payload for Substack's link-attachment endpoint. */
export interface CreateAttachmentRequest {
  url: string
  type: 'link'
}

/**
 * Payload for publishing a Note.
 *
 * `bodyJson` is the ProseMirror-style document accepted by Substack's web API.
 * It is left unmodified so callers can use every currently supported document
 * node and mark without this SDK becoming a schema bottleneck.
 */
export interface PublishNoteRequest {
  bodyJson: unknown
  tabId: string
  surface: string
  replyMinimumRole: 'everyone'
  attachmentIds?: string[]
}

export interface UnreadActivityMetadata {
  count: number
  max?: unknown
  lastViewedAt?: unknown
  strategy: 'latest-activity-items'
}

export type ActivityFeed = {
  activityItems?: unknown[]
  [key: string]: unknown
}

export type UnreadActivityFeed = ActivityFeed & {
  activityItems: unknown[]
  unread: UnreadActivityMetadata
}
