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

export interface ProfileNotesOptions extends CursorOptions {
  /** Requested upstream page size. */
  limit?: number
}

export interface NotesOptions extends ProfileNotesOptions {
  profileId?: number | string
}

export interface NoteActionOptions {
  /** Feed tab context sent to Substack. Defaults to `for-you`. */
  tabId?: string
}

export interface NoteLikeOptions extends NoteActionOptions {
  /** Publication context sent to Substack. Defaults to null. */
  publicationId?: number | null
}

export interface NoteCommentOptions extends NoteActionOptions {
  /** Interaction surface sent to Substack. Defaults to `feed`. */
  surface?: string
}

export interface NoteRestackOptions extends NoteActionOptions {
  /** Interaction surface sent when creating a restack. Defaults to `permalink`. */
  surface?: string
}

/** Current engagement counters copied into Note feed tracking metadata. */
export interface NoteTrackingParameters {
  item_current_reaction_count?: number
  item_current_reply_count?: number
  item_current_restack_count?: number
  [key: string]: unknown
}

/** An unmodified Note/comment object returned by Substack's reader endpoints. */
export interface NoteComment {
  id?: number
  post_id?: number | null
  publication_id?: number | null
  type?: string
  reaction?: string | boolean | null
  reaction_count?: number
  reactions?: Record<string, number>
  restacked?: boolean
  restacks?: number
  /** Direct child replies to this comment. */
  children_count?: number
  /** Unconfirmed candidates retained for forward-compatible raw response typing. */
  comment_count?: number
  reply_count?: number
  child_comment_count?: number
  descendant_comment_count?: number
  viewer_has_liked?: boolean
  viewer_has_restacked?: boolean
  views?: number
  view_count?: number
  tracking_parameters?: NoteTrackingParameters
  [key: string]: unknown
}

/** An unmodified reader-feed item whose `comment` is a Note. */
export interface NoteFeedItem<TComment extends NoteComment = NoteComment> {
  comment?: TComment
  trackingParameters?: NoteTrackingParameters
  [key: string]: unknown
}

/** The raw item returned by getProfileNotes(). */
export type ProfileNoteItem<T extends Record<string, unknown> = NoteFeedItem> = T

/** An unmodified page from Substack's profile Notes feed. */
export type ProfileNotesPage<T extends Record<string, unknown> = NoteFeedItem> = {
  items?: T[]
  nextCursor?: string | null
  originalCursorTimestamp?: string
  [key: string]: unknown
}

/** An unmodified response from Substack's single-Note reader endpoint. */
export type NoteResponse<TItem extends NoteFeedItem = NoteFeedItem> = {
  item?: TItem
  [key: string]: unknown
}

/** One reply item nested within a Note reply branch. */
export interface NoteReplyItem<TComment extends NoteComment = NoteComment> {
  comment?: TComment
  type?: string
  [key: string]: unknown
}

/** One direct Note reply and every nested reply returned in its branch. */
export interface NoteReplyBranch<TComment extends NoteComment = NoteComment>
  extends NoteReplyItem<TComment> {
  descendantComments?: NoteReplyItem<TComment>[]
}

/** An unmodified response page from Substack's Note replies endpoint. */
export type NoteRepliesResponse<
  TBranch = NoteReplyBranch,
  TRootComment = NoteComment
> = {
  commentBranches?: TBranch[]
  moreBranches?: number
  nextCursor?: string | null
  rootComment?: TRootComment
  automodHiddenBranches?: TBranch[]
  [key: string]: unknown
}

/** Normalized, reliably observed Note engagement fields. */
export interface NoteEngagement {
  reactionCount?: number
  /** Direct replies reported by the Note's `children_count` field. */
  reportedDirectReplyCount?: number
  /** Visible direct reply branches loaded across every reply page. */
  directReplyCount?: number
  /** Visible entries in every reply branch's `descendantComments` array. */
  nestedReplyCount?: number
  /** `directReplyCount + nestedReplyCount` when all reply pages are complete. */
  totalReplyCount?: number
  restackCount?: number
  /** Reserved for a future observed `views` or `view_count` field. */
  viewCount?: number
  viewerHasLiked?: boolean
  viewerHasRestacked?: boolean
  /** False when an upstream reply page cannot be safely aggregated. */
  replyCountsComplete: boolean
}

/** Raw Note data, raw reply pages, and explicitly normalized engagement totals. */
export interface NoteWithEngagement {
  note: NoteResponse
  replyPages: NoteRepliesResponse[]
  /** Visible direct reply branches flattened across every page. */
  replies: NoteReplyBranch[]
  engagement: NoteEngagement
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
  /** Publication analytics use these normalized names when present. */
  deliveryCount?: number
  openCount?: number
  clickCount?: number
  likeCount?: number
  commentCount?: number
  shareCount?: number
  viewCount?: number
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
  /** @deprecated Ignored. Substack's email-stats endpoint requires a fixed limit of 20. */
  limit?: number
  /** Upstream email-stat field to sort by. Defaults to `post_date`. */
  orderBy?: string
  /** Sort direction. Defaults to `desc`. */
  orderDirection?: 'asc' | 'desc'
}

/** One raw row from the publication email statistics endpoint. */
export type EmailStatsItem = EmailStatsRow

/** One raw row from the publication email statistics endpoint. */
export interface EmailStatsRow {
  post_id?: number
  title?: string
  post_date?: string
  audience?: string | number
  bylines?: string
  section_id?: number | null
  section_name?: string | null
  tags?: string
  type?: string
  sent?: number
  queued?: number
  delivered?: number
  dropped?: number
  opened?: number
  opens?: number
  open_rate?: number
  unique_opens_day7?: number
  unique_opens_day28?: number
  clicked?: number
  clicks?: number
  click_through_rate?: number
  likes?: number
  comments?: number
  shares?: number
  restacks?: number
  views?: number
  engagement_rate?: number
  unique_engagements?: number
  complaints?: number
  signups?: number
  signups_within_1_day?: number
  subscribes?: number
  subscriptions_within_1_day?: number
  annual_subscribes?: number
  monthly_subscribes?: number
  founding_subscribes?: number
  free_trials?: number
  free_to_paid_upgrades?: number
  unsubscribes?: number
  unsubscribes_within_1_day?: number
  disables_within_1_day?: number
  estimated_value?: number
  subscribers_finished_post?: number
  downloads?: number
  downloads_day7?: number
  downloads_day30?: number
  downloads_day90?: number
  podcast_preview_downloads?: number | string
  podcast_preview_downloads_day30?: number | string
  video_views?: number
  video_minutes_watched?: number
  [key: string]: unknown
}

/** An unmodified page from Substack's publication email statistics endpoint. */
export type EmailStatsPage<T = EmailStatsRow> = {
  rows?: T[]
  total?: number
  [key: string]: unknown
}

/** Per-post analytics nested under `posts[].stats` by post-management detail. */
export interface PostManagementStats extends EmailStatsRow {
  links?: Array<[string, number, ...unknown[]]>
  has_more_links?: boolean
  firstWeekDailyStats?: Array<Record<string, unknown>>
  referrers?: Record<string, unknown>
  comps?: Record<string, unknown>
  data_updated_at?: number | string
  [key: string]: unknown
}

/** One raw post object from the post-management detail endpoint. */
export interface PostManagementPost {
  id?: number
  publication_id?: number
  reaction?: string | boolean | null
  reaction_count?: number
  reactions?: Record<string, number>
  comment_count?: number
  child_comment_count?: number
  stats?: PostManagementStats
  [key: string]: unknown
}

/** Unmodified response from `/post_management/detail/{post_id}`. */
export type PostManagementDetail<TPost = PostManagementPost> = {
  posts?: TPost[]
  total?: number
  [key: string]: unknown
}

/** An unmodified or normalized response from Substack's publication subscriber statistics endpoint. */
export type SubscriberStatsResponse<T = unknown> = {
  total_subscribers?: number
  paid_subscribers?: number
  free_subscribers?: number
  app_subscribers?: number
  comp_subscribers?: number
  gift_subscribers?: number
  free_trial_subscribers?: number
  founding_subscribers?: number
  lifetime_subscribers?: number
  totalEmail?: number
  subscribers?: T[] | number
  active_subscribers_delivered?: number
  derived_from_delivery?: boolean
  recent_signups?: number
  open_rate?: string | number
  views?: number
  [key: string]: unknown
}

/** Publication paid subscribers and subscription tier breakdown. */
export interface PaidSubscribersBreakdown {
  total_subscribers: number
  paid_subscribers: number
  free_subscribers: number
  app_subscribers?: number
  comp_subscribers?: number
  gift_subscribers?: number
  free_trial_subscribers?: number
  founding_subscribers?: number
  lifetime_subscribers?: number
  pledges_amount?: number
  num_pledges?: number
  pledge_currency?: string
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

/** A person whose explicit `@handle` occurrence should become a Note tag. */
export interface NotePersonTag {
  /** Substack user ID stored in the mention node. */
  id: number | string
  /** Public handle matched in the Note body, with or without the leading `@`. */
  handle?: string
  /** Display name stored in the mention node. */
  label: string
  /** Optional profile URL stored by Substack. Defaults to null. */
  url?: string | null
}

export interface NoteBodyTextNode {
  type: 'text'
  text: string
}

export interface NotePersonTagNode {
  type: 'substack_mention'
  attrs: {
    id: number
    label: string
    mentionType: 'user'
    url: string | null
  }
}

export type NoteBodyInlineNode = NoteBodyTextNode | NotePersonTagNode

export interface NoteBodyParagraphNode {
  type: 'paragraph'
  content: NoteBodyInlineNode[]
}

/** Note document produced by createNoteBodyJson. */
export interface NoteBodyJson {
  type: 'doc'
  attrs: {
    schemaVersion: 'v1'
    title: null
  }
  content: NoteBodyParagraphNode[]
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
  /** IDs of attachments to retain on or add to the scheduled Note. */
  attachmentIds?: string[]
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

export interface GrowthInterval<TSource = GrowthSourceItem, TTotal = GrowthTotalItem> {
  startDate: string
  endDate: string
  totals?: TTotal[]
  sourceMetrics?: TSource[]
  [key: string]: unknown
}

export interface GrowthSourcesOptions {
  /** Start date in YYYY-MM-DD format. */
  fromDate?: string
  /** Start date alias (snake_case). */
  from_date?: string
  /** End date in YYYY-MM-DD format. */
  toDate?: string
  /** End date alias (snake_case). */
  to_date?: string
  /** Upstream metric to order by. Defaults to `users`. */
  orderBy?: 'users' | 'subscriptions' | 'annual_subscriptions' | 'revenue' | string
  /** Upstream metric to order by alias (snake_case). */
  order_by?: 'users' | 'subscriptions' | 'annual_subscriptions' | 'revenue' | string
  /** Sort direction. Defaults to `desc`. */
  orderDirection?: 'asc' | 'desc'
  /** Sort direction alias (snake_case). */
  order_direction?: 'asc' | 'desc'
  /** Trend aggregation granularity: 'total' (default), 'day' (max 31 days), 'week', or 'month'. */
  granularity?: 'total' | 'day' | 'week' | 'month'
}

export interface GrowthMetricTimeseriesPoint {
  date: string
  value: number
  [key: string]: unknown
}

export interface GrowthMetric {
  name: 'Traffic' | 'Subscribers' | 'Revenue' | string
  timeseries?: GrowthMetricTimeseriesPoint[]
  total?: number
  [key: string]: unknown
}

export interface GrowthSourceItem {
  source?: string
  sourceName?: string
  originalSourceName?: string
  category?: string
  logoUrl?: string
  href?: string
  pubId?: number
  noteId?: string
  isAggregation?: boolean
  metrics?: GrowthMetric[]
  children?: GrowthSourceItem[]
  [key: string]: unknown
}

export interface GrowthTotalItem {
  name?: 'traffic' | 'subscribers' | 'revenue' | string
  total?: number
  [key: string]: unknown
}

/** Response from Substack's publication growth sources endpoint. */
export type GrowthSourcesResponse<
  TSource = GrowthSourceItem,
  TTotal = GrowthTotalItem
> = {
  sourceMetrics?: TSource[]
  totals?: TTotal[]
  granularity?: 'total' | 'day' | 'week' | 'month'
  intervals?: GrowthInterval<TSource, TTotal>[]
  [key: string]: unknown
}
