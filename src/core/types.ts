export const ACTIVITY_FILTERS = ['all', 'replies-and-mentions', 'restacks'] as const

export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface SubstackClientOptions {
  /** The value of the authenticated Substack session cookie. */
  sessionToken?: string
  /** Legacy alias for sessionToken. */
  token?: string
  /**
   * HTTPS publication origin used by publication-scoped endpoints. Custom
   * domains are supported; callers must ensure the domain is trusted because
   * it receives the authenticated session cookie.
   */
  publicationUrl?: string
  /**
   * Global Substack origin. Defaults to https://substack.com. It must use
   * HTTPS; overriding it sends the authenticated session cookie to that origin.
   */
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

/** Options for the authenticated account's scheduled Note drafts. */
export interface DraftNotesOptions {
  /** Maximum drafts to return. Defaults to 20. */
  limit?: number
}

/** An unmodified page from Substack's scheduled Note drafts endpoint. */
export type DraftNotesPage<T = unknown> = {
  drafts?: T[]
  hasMore?: boolean
  nextCursor?: unknown
  [key: string]: unknown
}

export interface ProfilePostsOptions {
  limit?: number
  offset?: number
}

/** Controls optional data returned by getPostWithEngagement. */
export interface PostWithEngagementOptions {
  /** Include automoderated comments separately from the visible comment tree. Defaults to false. */
  includeAutomodHidden?: boolean
}

/** An unmodified comment object returned by Substack's post-comments endpoint. */
export interface SubstackPostComment {
  children?: SubstackPostComment[]
  reaction_count?: number
  restacks?: number
  [key: string]: unknown
}

/** Aggregate post and visible-comment engagement data. */
export interface PostEngagement {
  reactions?: unknown
  reactionCount?: number
  restackCount?: number
  /** The count reported by the post endpoint, which can include hidden or moderated comments. */
  reportedCommentCount?: number
  /** The reply count reported by the post endpoint. */
  reportedReplyCount?: number
  visibleRootCommentCount: number
  visibleCommentCount: number
  visibleReplyCount: number
  commentReactionCount: number
  commentRestackCount: number
}

/** A full post paired with its visible comment tree and calculated engagement totals. */
export interface PostWithEngagement {
  post: Record<string, unknown>
  publication?: unknown
  publicationSettings?: unknown
  /** Root comments only, with replies retained in each comment's children array. */
  comments: SubstackPostComment[]
  /** Every visible comment and reply in depth-first order. */
  commentItems: SubstackPostComment[]
  /** Returned only when includeAutomodHidden is true; never mixed with visible comments. */
  automodHiddenComments?: SubstackPostComment[]
  engagement: PostEngagement
}

/** Options for a publication's email performance report. */
export interface EmailStatsOptions {
  /** Zero-based row offset. Defaults to 0. */
  offset?: number
  /** Number of rows to return. Defaults to 20. */
  limit?: number
  /** Upstream email-stat field to sort by. Defaults to `post_date`. */
  orderBy?: string
  /** Sort direction. Defaults to `desc`. */
  orderDirection?: 'asc' | 'desc'
}

/** An unmodified page from Substack's publication email statistics endpoint. */
export type EmailStatsPage<T = unknown> = {
  rows?: T[]
  [key: string]: unknown
}

/** An unmodified response from Substack's publication subscriber statistics endpoint. */
export type SubscriberStatsResponse<T = unknown> = {
  subscribers?: T[]
  [key: string]: unknown
}

/** Payload for Substack's link-attachment endpoint. */
export interface CreateLinkAttachmentRequest {
  url: string
  type: 'link'
}

/** Payload for attaching an uploaded image to a Note. */
export interface CreateImageAttachmentRequest {
  type: 'image'
  url: string
}

/** Payload accepted by Substack's Note attachment endpoint. */
export type CreateAttachmentRequest = CreateLinkAttachmentRequest | CreateImageAttachmentRequest

/** Metadata returned after uploading an image to Substack. */
export interface UploadedImage {
  id: number
  url: string
  contentType: string
  bytes: number
  imageWidth: number
  imageHeight: number
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

/** Payload for scheduling a Note through Substack's draft endpoint. */
export interface ScheduleNoteRequest extends PublishNoteRequest {
  /** ISO 8601 timestamp at which Substack should publish the Note. */
  triggerAt: string
}

/** Payload for editing a scheduled Note draft. */
export interface UpdateScheduledNoteRequest {
  /** The ProseMirror-style Note document accepted by Substack's web API. */
  bodyJson: unknown
  replyMinimumRole: 'everyone'
  /** ISO 8601 timestamp at which Substack should publish the updated Note. */
  triggerAt: string
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
