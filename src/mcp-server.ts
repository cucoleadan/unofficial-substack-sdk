import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  SubstackApiError,
  SubstackClient,
  SubstackConfigurationError,
  type EmailStatsOptions,
  type EmailStatsRow,
  type GrowthSourcesOptions
} from './core/index.js'

type ReadOnlyClient = Pick<
  SubstackClient,
  | 'getAuthenticatedProfile'
  | 'getProfilePosts'
  | 'getEmailStats'
  | 'getAllEmailStats'
  | 'getPostManagementDetail'
  | 'getPostWithEngagement'
  | 'getNotes'
  | 'getProfileNotes'
  | 'getNoteWithEngagement'
  | 'getSubscriberStats'
  | 'getActivity'
  | 'getUnreadActivity'
  | 'getGrowthSources'
>

type ToolResult = {
  content: [{ type: 'text'; text: string }]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

type TopMetric = (typeof topMetrics)[number]

type PublicationAnalyticsOptions = EmailStatsOptions & {
  fromDate?: string
  toDate?: string
  topMetric?: TopMetric
  topLimit?: number
  includeRows?: boolean
  rowLimit?: number
}

const id = z.union([z.number().int().positive(), z.string().min(1)])
const limit = z.number().int().min(1).max(50).default(20)
const noteLimit = z.number().int().min(1).max(50).default(10)
const fetchAll = z.boolean().default(false)
const maxNoteItems = z.number().int().min(1).max(5_000).default(500)
const emailRowLimit = z.number().int().min(1).max(20).default(20)
const rawRowLimit = z.number().int().min(1).max(200).default(20)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const orderDirection = z.enum(['asc', 'desc']).default('desc')
const growthSourcesOrderBy = z
  .enum(['users', 'subscriptions', 'annual_subscriptions', 'revenue'])
  .default('users')
const activityFilter = z.enum(['all', 'replies-and-mentions', 'restacks']).default('all')
const topMetrics = [
  'opens',
  'clicks',
  'views',
  'engagement_rate',
  'subscribes',
  'estimated_value',
  'likes',
  'comments',
  'shares',
  'restacks',
  'downloads',
  'video_views'
] as const

const additiveMetrics = [
  'sent',
  'queued',
  'delivered',
  'dropped',
  'opened',
  'opens',
  'unique_opens_day7',
  'unique_opens_day28',
  'clicked',
  'clicks',
  'likes',
  'comments',
  'shares',
  'restacks',
  'views',
  'unique_engagements',
  'complaints',
  'signups',
  'signups_within_1_day',
  'subscribes',
  'subscriptions_within_1_day',
  'annual_subscribes',
  'monthly_subscribes',
  'founding_subscribes',
  'free_trials',
  'free_to_paid_upgrades',
  'unsubscribes',
  'unsubscribes_within_1_day',
  'disables_within_1_day',
  'estimated_value',
  'subscribers_finished_post',
  'downloads',
  'downloads_day7',
  'downloads_day30',
  'downloads_day90',
  'podcast_preview_downloads',
  'podcast_preview_downloads_day30',
  'video_views',
  'video_minutes_watched'
] as const

const averageMetrics = ['open_rate', 'click_through_rate', 'engagement_rate'] as const

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} as const

const authenticatedProfileOutputSchema = {
  data: z
    .object({
      id: z.number().describe('Numeric author / user profile ID'),
      handle: z.string().optional().describe('Substack username handle'),
      name: z.string().optional().describe('Display name'),
      photo_url: z.string().optional(),
      bio: z.string().optional()
    })
    .passthrough()
}

const recentPostsOutputSchema = {
  data: z
    .object({
      posts: z.array(z.record(z.string(), z.unknown())).describe('Recent published posts'),
      cursor: z.string().optional().describe('Pagination cursor for the next page')
    })
    .passthrough()
}

const emailStatsOutputSchema = {
  data: z
    .object({
      rows: z.array(z.record(z.string(), z.unknown())).describe('Email stats rows for sent posts'),
      offset: z.number().optional().describe('Pagination offset'),
      limit: z.number().optional().describe('Row limit')
    })
    .passthrough()
}

const publicationAnalyticsOutputSchema = {
  data: z
    .object({
      totals: z.record(z.string(), z.unknown()).describe('Aggregate metric totals across email history'),
      summary: z.record(z.string(), z.unknown()).optional().describe('Average open, click, and engagement rates'),
      breakdowns: z.record(z.string(), z.unknown()).optional().describe('Aggregates broken down by audience and post type'),
      top_posts: z.array(z.record(z.string(), z.unknown())).optional().describe('Top performing posts ranked by requested metric'),
      rows: z.array(z.record(z.string(), z.unknown())).optional().describe('Bounded raw email rows if include_rows was requested')
    })
    .passthrough()
}

const postEngagementOutputSchema = {
  data: z
    .object({
      post: z.record(z.string(), z.unknown()).optional().describe('Post content and metadata'),
      comments: z.array(z.record(z.string(), z.unknown())).optional().describe('Visible reader comments'),
      engagement: z.record(z.string(), z.unknown()).optional().describe('Calculated reaction, comment, and engagement totals')
    })
    .passthrough()
}

const postAnalyticsOutputSchema = {
  data: z
    .object({
      post: z.record(z.string(), z.unknown()).optional().describe('Post details'),
      engagement: z.record(z.string(), z.unknown()).optional().describe('Calculated engagement summary'),
      stats: z.record(z.string(), z.unknown()).optional().describe('Author analytics including traffic, conversions, and delivery')
    })
    .passthrough()
}

const compactNoteSchema = z.object({
  id: z.union([z.number(), z.string()]).optional().describe('Note ID'),
  body: z.string().describe('Complete Note body'),
  created_at: z.string().optional().describe('Note publication timestamp'),
  url: z.string().optional().describe('Note permalink when supplied upstream'),
  attachments: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('Minimal attachment details for Notes without a text body')
})

const notesOutputSchema = {
  data: z
    .object({
      items: z.array(compactNoteSchema).describe('Body-first Note records'),
      returned: z.number().int().nonnegative().describe('Number of Notes returned'),
      pages_fetched: z.number().int().positive().describe('Number of upstream pages fetched'),
      complete: z.boolean().describe('Whether the requested collection was fully fetched'),
      has_more: z.boolean().describe('Whether another page is available'),
      cursor: z.string().nullable().describe('Pagination cursor for the next page')
    })
}

const profileNotesOutputSchema = {
  data: z
    .object({
      items: z.array(compactNoteSchema).describe('Body-first Notes published by the profile'),
      returned: z.number().int().nonnegative().describe('Number of Notes returned'),
      pages_fetched: z.number().int().positive().describe('Number of upstream pages fetched'),
      complete: z.boolean().describe('Whether the requested collection was fully fetched'),
      has_more: z.boolean().describe('Whether another page is available'),
      cursor: z.string().nullable().describe('Pagination cursor for the next page')
    })
}

const noteEngagementOutputSchema = {
  data: z
    .object({
      item: z.record(z.string(), z.unknown()).optional().describe('Note item details'),
      replies: z.array(z.record(z.string(), z.unknown())).optional().describe('Visible Note replies'),
      engagement: z.record(z.string(), z.unknown()).optional().describe('Calculated reaction and restack totals')
    })
    .passthrough()
}

const subscriberSummaryOutputSchema = {
  data: z
    .object({
      count: z.number().optional().describe('Total active subscriber count'),
      aggregates: z.record(z.string(), z.unknown()).optional().describe('Aggregated subscriber stats'),
      subscribers: z.array(z.record(z.string(), z.unknown())).optional().describe('Raw subscriber records (only when requested)')
    })
    .passthrough()
}

const subscriberStatsOutputSchema = {
  data: z
    .object({
      total_subscribers: z.number().optional().describe('Total subscriber count'),
      active_subscribers_delivered: z.number().optional().describe('Subscribers delivered on latest email'),
      recent_signups: z.number().optional().describe('Recent email signups count'),
      open_rate: z.number().optional().describe('Open rate percentage'),
      latest_post_title: z.string().optional().describe('Title of latest delivered post'),
      derived_from_delivery: z.boolean().optional().describe('Whether stats were derived from email delivery')
    })
    .passthrough()
}

const activityOutputSchema = {
  data: z
    .object({
      activityItems: z.array(z.record(z.string(), z.unknown())).describe('Activity notification items'),
      more: z.boolean().optional().describe('Whether more activity is available upstream')
    })
    .passthrough()
}

const unreadActivityOutputSchema = {
  data: z
    .object({
      activityItems: z.array(z.record(z.string(), z.unknown())).describe('Unread activity notification items'),
      unread: z.record(z.string(), z.unknown()).optional().describe('Unread count and metadata')
    })
    .passthrough()
}

const analyzeContentOutputSchema = {
  data: z
    .object({
      post_id: z.union([z.number(), z.string()]).optional().describe('Post ID'),
      title: z.string().optional().describe('Post title'),
      performance: z.record(z.string(), z.unknown()).optional().describe('Performance and conversion summary'),
      engagement: z.record(z.string(), z.unknown()).optional().describe('Engagement summary')
    })
    .passthrough()
}

const growthMetricPointSchema = z.object({
  date: z.string().describe('Snapshot or entry date'),
  value: z.number().describe('Metric value')
})

const growthMetricSchema = z.object({
  name: z.string().describe('Metric name (Traffic, Subscribers, Revenue)'),
  total: z.number().nullable().optional().describe('Total aggregate for the period'),
  timeseries: z.array(growthMetricPointSchema).optional()
})

const growthSourceItemSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    source: z.string().optional().describe('Source identifier slug'),
    sourceName: z.string().optional().describe('Display source name'),
    category: z.string().optional().describe('Source category'),
    logoUrl: z.string().optional(),
    metrics: z.array(growthMetricSchema).optional(),
    children: z.array(growthSourceItemSchema).optional()
  })
)

const growthIntervalSchema = z.object({
  startDate: z.string().describe('Interval start date (YYYY-MM-DD)'),
  endDate: z.string().describe('Interval end date (YYYY-MM-DD)'),
  totals: z
    .array(
      z.object({
        name: z.string().optional(),
        total: z.number().nullable().optional()
      })
    )
    .optional(),
  sourceMetrics: z.array(growthSourceItemSchema).optional()
})

const growthSourcesOutputSchema = {
  data: z
    .object({
      granularity: z
        .enum(['total', 'day', 'week', 'month'])
        .optional()
        .describe('Aggregation granularity'),
      totals: z
        .array(
          z.object({
            name: z.string().optional().describe('Metric name (traffic, subscribers, revenue)'),
            total: z.number().nullable().optional().describe('Total value across period')
          })
        )
        .optional(),
      intervals: z
        .array(growthIntervalSchema)
        .optional()
        .describe('Interval slices when granularity is day, week, or month'),
      sourceMetrics: z
        .array(growthSourceItemSchema)
        .optional()
        .describe('Acquisition sources when granularity is total')
    })
    .passthrough()
}

const growthSourcesGranularity = z
  .enum(['total', 'day', 'week', 'month'])
  .default('total')
  .describe(
    'Aggregation interval: "total" for full period aggregate (1 fast call), "week" for weekly trend intervals (max 26 weeks), "day" for daily trend intervals (max 31 days), or "month" for monthly trend intervals (max 24 months). Requests are rate-limited to max 2 req/sec.'
  )

function result(data: unknown): ToolResult {
  const output = { data }
  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    structuredContent: output
  }
}

function failure(error: unknown): ToolResult {
  let message = error instanceof Error ? error.message : 'Unknown error.'
  if (error instanceof SubstackApiError && (error.status === 401 || error.status === 403)) {
    message = 'Substack authentication failed. Check SUBSTACK_SESSION_TOKEN and publication access.'
  } else if (error instanceof SubstackConfigurationError) {
    message = `Configuration error: ${message}`
  }
  return { content: [{ type: 'text', text: message }], isError: true }
}

function capped(data: unknown, maximum: number): unknown {
  if (Array.isArray(data)) return data.slice(0, maximum)
  if (!data || typeof data !== 'object') return data
  const output = { ...(data as Record<string, unknown>) }
  for (const key of ['posts', 'items', 'rows', 'activityItems', 'comments', 'replies']) {
    if (Array.isArray(output[key])) output[key] = output[key].slice(0, maximum)
  }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function compactPost(post: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'id',
    'title',
    'subtitle',
    'slug',
    'canonical_url',
    'post_date',
    'audience',
    'type',
    'wordcount'
  ]
  return Object.fromEntries(keys.filter((key) => post[key] !== undefined).map((key) => [key, post[key]]))
}

function selectDefined(
  record: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  return Object.fromEntries(
    keys
      .filter((key) => record[key] !== undefined && record[key] !== null)
      .map((key) => [key, record[key]])
  )
}

function compactProfile(profile: unknown): Record<string, unknown> {
  return isRecord(profile)
    ? selectDefined(profile, ['id', 'handle', 'name', 'photo_url', 'bio'])
    : {}
}

function bodyJsonText(value: unknown): string {
  if (Array.isArray(value)) return value.map(bodyJsonText).filter(Boolean).join('\n')
  if (!isRecord(value)) return ''
  if (typeof value.text === 'string') return value.text
  return bodyJsonText(value.content)
}

function compactAttachment(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const post = isRecord(value.post) ? value.post : undefined
  const comment = isRecord(value.comment) ? value.comment : undefined
  const compact = selectDefined(value, ['id', 'type', 'url', 'title'])
  const body = typeof comment?.body === 'string' ? comment.body : undefined
  const title = typeof post?.title === 'string' ? post.title : undefined
  const url =
    typeof post?.canonical_url === 'string'
      ? post.canonical_url
      : typeof comment?.canonical_url === 'string'
        ? comment.canonical_url
        : undefined
  return {
    ...compact,
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
    ...(url ? { url } : {})
  }
}

function compactNote(value: unknown): Record<string, unknown> {
  const item = isRecord(value) ? value : {}
  const comment = isRecord(item.comment) ? item.comment : item
  const context = isRecord(item.context) ? item.context : undefined
  const entityKey = typeof item.entity_key === 'string' ? item.entity_key : undefined
  const parsedEntityId = entityKey?.startsWith('c-') ? finiteNumber(entityKey.slice(2)) : undefined
  const body =
    typeof comment.body === 'string'
      ? comment.body
      : bodyJsonText(comment.body_json)
  const createdAt =
    typeof comment.date === 'string'
      ? comment.date
      : typeof comment.created_at === 'string'
        ? comment.created_at
        : typeof context?.timestamp === 'string'
          ? context.timestamp
          : undefined
  const urlCandidate = [comment.url, comment.canonical_url, item.url, item.canonical_url].find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0
  )
  const attachments = Array.isArray(comment.attachments)
    ? comment.attachments.map(compactAttachment).filter(isRecord)
    : []

  return {
    ...(comment.id !== undefined
      ? { id: comment.id }
      : item.id !== undefined
        ? { id: item.id }
        : parsedEntityId !== undefined
          ? { id: parsedEntityId }
          : {}),
    body,
    ...(createdAt ? { created_at: createdAt } : {}),
    ...(urlCandidate ? { url: urlCandidate } : {}),
    ...(!body.trim() && attachments.length > 0 ? { attachments } : {})
  }
}

function compactComment(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  const compact = selectDefined(value, [
    'id',
    'body',
    'date',
    'created_at',
    'name',
    'handle',
    'user_id',
    'parent_id',
    'reaction_count',
    'restacks',
    'children_count'
  ])
  if (Array.isArray(value.children)) {
    compact.children = value.children.map(compactComment)
  }
  return compact
}

function compactReply(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  const reply = isRecord(value.comment) ? compactComment(value.comment) : compactComment(value)
  if (Array.isArray(value.descendantComments)) {
    reply.descendant_replies = value.descendantComments.map((descendant) =>
      isRecord(descendant) && isRecord(descendant.comment)
        ? compactComment(descendant.comment)
        : compactComment(descendant)
    )
  }
  return reply
}

function compactActivityItem(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  return selectDefined(value, [
    'id',
    'user_id',
    'item_key',
    'type',
    'created_at',
    'updated_at',
    'sender_count',
    'recent_sender_ids',
    'publication_id',
    'comment_id',
    'mention_id',
    'target_user_id',
    'target_post_id',
    'target_comment_id',
    'target_community_post_id',
    'target_community_comment_id',
    'target_live_stream_id',
    'target_media_clip_id',
    'source',
    'source_name',
    'isNew',
    'cta',
    'secondaryCta'
  ])
}

type CompactNotesOptions = {
  cursor?: string
  limit: number
  fetchAll: boolean
  maxItems: number
}

async function collectCompactNotes(
  fetchPage: (cursor: string | undefined, limit: number) => Promise<unknown>,
  options: CompactNotesOptions
): Promise<Record<string, unknown>> {
  const items: Record<string, unknown>[] = []
  const seenIds = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor = options.cursor
  let pagesFetched = 0
  let complete = false

  while (true) {
    const pageCursor = cursor
    const pageLimit = options.fetchAll
      ? Math.max(1, Math.min(50, options.maxItems - items.length))
      : options.limit
    const response = await fetchPage(pageCursor, pageLimit)
    pagesFetched += 1
    const page = isRecord(response) ? response : {}
    const pageItems = Array.isArray(page.items) ? page.items.map(compactNote) : []
    const uniquePageItems = pageItems.filter((item) => {
      if (item.id === undefined) return true
      const key = String(item.id)
      if (seenIds.has(key)) return false
      seenIds.add(key)
      return true
    })
    const nextCursor =
      typeof page.nextCursor === 'string' && page.nextCursor.length > 0
        ? page.nextCursor
        : undefined

    if (options.fetchAll && items.length > 0 && items.length + uniquePageItems.length > options.maxItems) {
      cursor = pageCursor
      break
    }

    const remaining = options.fetchAll ? options.maxItems - items.length : options.limit
    items.push(...uniquePageItems.slice(0, remaining))
    if (!options.fetchAll) {
      cursor = nextCursor
      complete = !nextCursor
      break
    }
    if (!nextCursor) {
      cursor = undefined
      complete = true
      break
    }
    if (seenCursors.has(nextCursor)) {
      cursor = nextCursor
      break
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
    if (items.length >= options.maxItems) break
  }

  return {
    items,
    returned: items.length,
    pages_fetched: pagesFetched,
    complete,
    has_more: !complete,
    cursor: cursor ?? null
  }
}

function filterRowsByDate(
  rows: EmailStatsRow[],
  fromDate?: string,
  toDate?: string
): EmailStatsRow[] {
  return rows.filter((row) => {
    if (!fromDate && !toDate) return true
    if (typeof row.post_date !== 'string') return false
    const postDate = row.post_date.slice(0, 10)
    return (!fromDate || postDate >= fromDate) && (!toDate || postDate <= toDate)
  })
}

function dimensionCounts(rows: EmailStatsRow[], field: keyof EmailStatsRow): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) {
    const value = row[field]
    if (value === undefined || value === null || value === '') continue
    const key = String(value)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]))
}

function summarizeEmailStats(
  rows: EmailStatsRow[],
  options: Pick<PublicationAnalyticsOptions, 'topMetric' | 'topLimit' | 'includeRows' | 'rowLimit'>
) {
  const totals: Record<string, number> = {}
  for (const field of additiveMetrics) {
    const values = rows.map((row) => finiteNumber(row[field])).filter((value) => value !== undefined)
    if (values.length > 0) totals[field] = values.reduce((sum, value) => sum + value, 0)
  }

  const averages: Record<string, number> = {}
  for (const field of averageMetrics) {
    const values = rows.map((row) => finiteNumber(row[field])).filter((value) => value !== undefined)
    if (values.length > 0) averages[field] = values.reduce((sum, value) => sum + value, 0) / values.length
  }

  const dates = rows
    .map((row) => row.post_date)
    .filter((value): value is string => typeof value === 'string')
    .sort()
  const topMetric = options.topMetric ?? 'engagement_rate'
  const topPosts = rows
    .filter((row) => finiteNumber(row[topMetric]) !== undefined)
    .sort((a, b) => (finiteNumber(b[topMetric]) ?? 0) - (finiteNumber(a[topMetric]) ?? 0))
    .slice(0, options.topLimit ?? 10)
    .map((row) => ({
      post_id: row.post_id,
      title: row.title,
      post_date: row.post_date,
      [topMetric]: row[topMetric]
    }))

  return {
    rowsAnalyzed: rows.length,
    dateRange: dates.length > 0 ? { from: dates[0], to: dates.at(-1) } : undefined,
    totals,
    summary: averages,
    breakdowns: {
      byAudience: dimensionCounts(rows, 'audience'),
      bySection: dimensionCounts(rows, 'section_name'),
      byType: dimensionCounts(rows, 'type')
    },
    top_metric: topMetric,
    top_posts: topPosts,
    availableFields: [...new Set(rows.flatMap((row) => Object.keys(row)))].sort(),
    ...(options.includeRows ? { rows: rows.slice(0, options.rowLimit ?? 20) } : {})
  }
}

function safeSubscriberMetadata(response: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(response).filter(
      ([key, value]) => key !== 'subscribers' && (typeof value === 'number' || typeof value === 'boolean')
    )
  )
}

function subscriberCount(response: Record<string, unknown>, records: unknown[]): number {
  for (const key of ['total', 'count', 'subscriber_count', 'subscriberCount']) {
    const value = finiteNumber(response[key])
    if (value !== undefined && value >= 0) return Math.floor(value)
  }
  return records.length
}

function optionalSubscriberCount(
  response: Record<string, unknown>,
  records: unknown[]
): number | undefined {
  for (const key of ['total', 'count', 'subscriber_count', 'subscriberCount']) {
    const value = finiteNumber(response[key])
    if (value !== undefined && value >= 0) return Math.floor(value)
  }
  return Array.isArray(response.subscribers) ? records.length : undefined
}

export function createToolHandlers(client: ReadOnlyClient) {
  const run = async (work: () => Promise<unknown>) => {
    try {
      return result(await work())
    } catch (error) {
      return failure(error)
    }
  }

  const loadPostAnalytics = async (
    postId: string | number,
    commentLimit = 20,
    includeRaw = false
  ) => {
    const [postResult, managementDetail] = await Promise.all([
      client.getPostWithEngagement(postId),
      client.getPostManagementDetail(postId)
    ])
    const managementPost = Array.isArray(managementDetail.posts)
      ? managementDetail.posts.find((post) => String(post.id) === String(postId)) ?? managementDetail.posts[0]
      : undefined
    const managementEngagement = managementPost
      ? {
          reaction_count: managementPost.reaction_count,
          reactions: managementPost.reactions,
          comment_count: managementPost.comment_count,
          reply_count: managementPost.child_comment_count
        }
      : undefined

    return {
      post: compactPost(postResult.post),
      stats: managementPost?.stats,
      engagement: {
        content: postResult.engagement,
        management: managementEngagement
      },
      comments: postResult.commentItems.slice(0, commentLimit).map(compactComment),
      comments_returned: Math.min(commentLimit, postResult.commentItems.length),
      visible_comment_count: postResult.commentItems.length,
      ...(includeRaw ? { raw: { post: postResult.post, managementDetail } } : {})
    }
  }

  const getPostAnalytics = (
    postId: string | number,
    commentLimit = 20,
    includeRaw = false
  ) => run(() => loadPostAnalytics(postId, commentLimit, includeRaw))

  return {
    getAuthenticatedProfile: () => run(async () => compactProfile(await client.getAuthenticatedProfile())),
    getRecentPosts: (profileId: string | number, maximum = 20) =>
      run(async () => {
        const response = await client.getProfilePosts(profileId, { limit: maximum })
        const record = isRecord(response) ? response : {}
        return {
          posts: Array.isArray(record.posts)
            ? record.posts.slice(0, maximum).map((post) => compactPost(isRecord(post) ? post : {}))
            : [],
          ...(typeof record.nextCursor === 'string' ? { cursor: record.nextCursor } : {})
        }
      }),
    getEmailStats: (options: EmailStatsOptions, maximum = 20) =>
      run(async () => capped(await client.getEmailStats(options), maximum)),
    getPublicationAnalytics: (options: PublicationAnalyticsOptions = {}) =>
      run(async () => {
        if (options.fromDate && options.toDate && options.fromDate > options.toDate) {
          throw new SubstackConfigurationError('Publication analytics fromDate cannot be after toDate.')
        }
        const rows = await client.getAllEmailStats<EmailStatsRow>({
          offset: options.offset,
          orderBy: options.orderBy,
          orderDirection: options.orderDirection
        })
        return {
          sourceRowsFetched: rows.length,
          filters: {
            offset: options.offset ?? 0,
            fromDate: options.fromDate,
            toDate: options.toDate
          },
          ...summarizeEmailStats(filterRowsByDate(rows, options.fromDate, options.toDate), options)
        }
      }),
    getPostEngagement: (postId: string | number, maximum = 20) =>
      run(async () => {
        const { post, engagement, commentItems } = await client.getPostWithEngagement(postId)
        return {
          post: compactPost(post),
          engagement,
          comments: commentItems.slice(0, maximum).map(compactComment)
        }
      }),
    getPostAnalytics,
    getNotes: (
      cursor: string | undefined,
      maximum = 10,
      profileId?: string | number,
      fetchEveryPage = false,
      maximumItems = 500
    ) =>
      run(() =>
        collectCompactNotes(
          (pageCursor, pageLimit) =>
            client.getNotes({ cursor: pageCursor, profileId, limit: pageLimit }),
          { cursor, limit: maximum, fetchAll: fetchEveryPage, maxItems: maximumItems }
        )
      ),
    getProfileNotes: (
      profileId: string | number,
      cursor: string | undefined,
      maximum = 10,
      fetchEveryPage = false,
      maximumItems = 500
    ) =>
      run(() =>
        collectCompactNotes(
          (pageCursor, pageLimit) =>
            client.getProfileNotes(profileId, { cursor: pageCursor, limit: pageLimit }),
          { cursor, limit: maximum, fetchAll: fetchEveryPage, maxItems: maximumItems }
        )
      ),
    getNoteEngagement: (
      noteId: string | number,
      maximum = 20,
      includeRawPages = false
    ) =>
      run(async () => {
        const noteResult = await client.getNoteWithEngagement(noteId)
        return {
          item: compactNote(noteResult.note.item),
          engagement: noteResult.engagement,
          reply_pages_fetched: noteResult.replyPages.length,
          replies: noteResult.replies.slice(0, maximum).map(compactReply),
          replies_returned: Math.min(maximum, noteResult.replies.length),
          ...(includeRawPages ? { raw_reply_pages: noteResult.replyPages } : {})
        }
      }),
    getSubscriberSummary: (includeRecords = false, maximum = 20) =>
      run(async () => {
        const response = await client.getSubscriberStats<Record<string, unknown>>()
        const record = isRecord(response) ? response : {}
        const subscribers = Array.isArray(response.subscribers) ? response.subscribers : []
        return {
          count: subscriberCount(record, subscribers),
          records_returned_by_upstream: subscribers.length,
          aggregates: safeSubscriberMetadata(record),
          available_record_fields: [
            ...new Set(
              subscribers.flatMap((subscriber) => (isRecord(subscriber) ? Object.keys(subscriber) : []))
            )
          ].sort(),
          personal_data_included: includeRecords,
          ...(includeRecords ? { subscribers: subscribers.slice(0, maximum) } : {})
        }
      }),
    getActivity: (filter: 'all' | 'replies-and-mentions' | 'restacks', maximum = 20) =>
      run(async () => {
        const response = await client.getActivity(filter)
        return {
          activityItems: Array.isArray(response.activityItems)
            ? response.activityItems.slice(0, maximum).map(compactActivityItem)
            : [],
          ...(typeof response.more === 'boolean' ? { more: response.more } : {})
        }
      }),
    getUnreadActivity: (maximum = 20) =>
      run(async () => {
        const response = await client.getUnreadActivity()
        return {
          activityItems: response.activityItems.slice(0, maximum).map(compactActivityItem),
          unread: response.unread,
          ...(typeof response.more === 'boolean' ? { more: response.more } : {})
        }
      }),
    analyzeContent: (postId: string | number) =>
      run(async () => {
        const analytics = await loadPostAnalytics(postId, 0, false)
        const post = isRecord(analytics.post) ? analytics.post : {}
        return {
          post_id: post.id ?? postId,
          ...(typeof post.title === 'string' ? { title: post.title } : {}),
          performance: analytics.stats,
          engagement: analytics.engagement
        }
      }),
    getSubscriberStats: () =>
      run(async () => {
        const response = await client.getSubscriberStats<Record<string, unknown>>()
        const record = isRecord(response) ? response : {}
        const subscribers = Array.isArray(record.subscribers) ? record.subscribers : []
        const count = optionalSubscriberCount(record, subscribers)
        return {
          ...(count !== undefined ? { total_subscribers: count } : {}),
          ...selectDefined(record, [
            'active_subscribers_delivered',
            'recent_signups',
            'open_rate',
            'latest_post_title',
            'derived_from_delivery'
          ])
        }
      }),
    getGrowthSources: (options: GrowthSourcesOptions = {}) =>
      run(async () => {
        const fromDate = options.fromDate ?? options.from_date
        const toDate = options.toDate ?? options.to_date
        if (fromDate && toDate && fromDate > toDate) {
          throw new SubstackConfigurationError('Growth sources fromDate cannot be after toDate.')
        }
        return client.getGrowthSources(options)
      })
  }
}

export function createMcpServer(client: ReadOnlyClient): McpServer {
  const server = new McpServer({ name: 'substack-mcp', version: '0.3.11' })
  const tools = createToolHandlers(client)

  const register = (
    names: readonly string[],
    definition: Record<string, unknown>,
    handler?: (...args: any[]) => unknown
  ) => {
    for (const name of names) {
      if (handler) {
        ;(server as any).registerTool(name, definition, handler)
      } else {
        ;(server as any).registerTool(name, definition)
      }
    }
  }

  register(
    ['get_authenticated_profile', 'getAuthenticatedProfile'],
    {
      title: 'Get authenticated Substack profile',
      description: 'Get the authenticated profile, including the profile ID needed by profile tools.',
      outputSchema: authenticatedProfileOutputSchema,
      annotations: readOnlyAnnotations
    },
    () => tools.getAuthenticatedProfile()
  )
  register(
    ['get_recent_posts', 'getRecentPosts'],
    {
      title: 'Get recent posts',
      description: 'Get recent posts for a Substack profile.',
      inputSchema: {
        profile_id: id.optional(),
        profileId: id.optional(),
        limit
      },
      outputSchema: recentPostsOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) => tools.getRecentPosts(args.profile_id ?? args.profileId, args.limit)
  )
  register(
    ['get_email_stats', 'getEmailStats'],
    {
      title: 'Get one email statistics page',
      description:
        'Get one fixed 20-row Substack email-stat page. Limit caps the returned rows but not the upstream page size.',
      inputSchema: {
        offset: z.number().int().nonnegative().default(0),
        limit: emailRowLimit,
        order_by: z.string().min(1).default('post_date'),
        orderBy: z.string().min(1).optional(),
        order_direction: orderDirection,
        orderDirection: orderDirection.optional()
      },
      outputSchema: emailStatsOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) =>
      tools.getEmailStats(
        {
          offset: args.offset,
          orderBy: args.order_by ?? args.orderBy ?? 'post_date',
          orderDirection: args.order_direction ?? args.orderDirection ?? 'desc'
        },
        args.limit
      )
  )
  register(
    ['get_publication_analytics', 'getPublicationAnalytics'],
    {
      title: 'Analyze publication performance',
      description:
        'Analyze all publication email-stat history with totals, average upstream rates, breakdowns, top posts, and optional bounded raw rows.',
      inputSchema: {
        offset: z.number().int().nonnegative().default(0),
        from_date: date.optional(),
        fromDate: date.optional(),
        to_date: date.optional(),
        toDate: date.optional(),
        order_by: z.string().min(1).default('post_date'),
        orderBy: z.string().min(1).optional(),
        order_direction: orderDirection,
        orderDirection: orderDirection.optional(),
        top_metric: z.enum(topMetrics).default('engagement_rate'),
        topMetric: z.enum(topMetrics).optional(),
        top_limit: z.number().int().min(1).max(50).default(10),
        topLimit: z.number().int().min(1).max(50).optional(),
        include_rows: z.boolean().default(false),
        includeRows: z.boolean().default(false),
        row_limit: rawRowLimit,
        rowLimit: rawRowLimit.optional()
      },
      outputSchema: publicationAnalyticsOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) =>
      tools.getPublicationAnalytics({
        offset: args.offset,
        fromDate: args.from_date ?? args.fromDate,
        toDate: args.to_date ?? args.toDate,
        orderBy: args.order_by ?? args.orderBy ?? 'post_date',
        orderDirection: args.order_direction ?? args.orderDirection ?? 'desc',
        topMetric: args.top_metric ?? args.topMetric ?? 'engagement_rate',
        topLimit: args.top_limit ?? args.topLimit ?? 10,
        includeRows: args.include_rows ?? args.includeRows ?? false,
        rowLimit: args.row_limit ?? args.rowLimit ?? 20
      })
  )
  register(
    ['get_post_engagement', 'getPostEngagement'],
    {
      title: 'Get post engagement',
      description: 'Get a post, its visible comments, and content engagement totals.',
      inputSchema: {
        post_id: id.optional(),
        postId: id.optional(),
        comment_limit: limit,
        commentLimit: limit.optional()
      },
      outputSchema: postEngagementOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) =>
      tools.getPostEngagement(
        args.post_id ?? args.postId,
        args.comment_limit ?? args.commentLimit
      )
  )
  register(
    ['get_post_analytics', 'getPostAnalytics'],
    {
      title: 'Get complete post analytics',
      description:
        'Combine author analytics with visible post and comment engagement, including delivery, conversion, media, link, referrer, daily, and comparison data when available.',
      inputSchema: {
        post_id: id.optional(),
        postId: id.optional(),
        comment_limit: limit,
        commentLimit: limit.optional(),
        include_raw: z.boolean().default(false),
        includeRaw: z.boolean().default(false)
      },
      outputSchema: postAnalyticsOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) =>
      tools.getPostAnalytics(
        args.post_id ?? args.postId,
        args.comment_limit ?? args.commentLimit,
        args.include_raw ?? args.includeRaw
      )
  )
  register(
    ['get_notes', 'getNotes'],
    {
      title: 'Get publication Notes',
      description:
        'Get compact, body-first Notes from the authenticated profile or a specified profile ID. Set fetch_all to follow pagination safely up to max_items.',
      inputSchema: {
        profile_id: id.optional(),
        profileId: id.optional(),
        cursor: z.string().optional(),
        limit: noteLimit,
        fetch_all: fetchAll,
        fetchAll: fetchAll.optional(),
        max_items: maxNoteItems,
        maxItems: maxNoteItems.optional()
      },
      outputSchema: notesOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) =>
      tools.getNotes(
        args.cursor,
        args.limit,
        args.profile_id ?? args.profileId,
        args.fetch_all ?? args.fetchAll,
        args.max_items ?? args.maxItems
      )
  )
  register(
    ['get_profile_notes', 'getProfileNotes'],
    {
      title: 'Get profile Notes',
      description:
        'Get compact, body-first Notes for a profile. Set fetch_all to follow pagination safely up to max_items.',
      inputSchema: {
        profile_id: id.optional(),
        profileId: id.optional(),
        cursor: z.string().optional(),
        limit: noteLimit,
        fetch_all: fetchAll,
        fetchAll: fetchAll.optional(),
        max_items: maxNoteItems,
        maxItems: maxNoteItems.optional()
      },
      outputSchema: profileNotesOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) =>
      tools.getProfileNotes(
        args.profile_id ?? args.profileId,
        args.cursor,
        args.limit,
        args.fetch_all ?? args.fetchAll,
        args.max_items ?? args.maxItems
      )
  )
  register(
    ['get_note_engagement', 'getNoteEngagement'],
    {
      title: 'Get complete Note engagement',
      description:
        'Get Note reactions, restacks, viewer state, and fully paginated visible direct, nested, and total reply counts. Note views are returned only if Substack supplies them.',
      inputSchema: {
        note_id: id.optional(),
        noteId: id.optional(),
        reply_limit: limit,
        replyLimit: limit.optional(),
        include_raw_pages: z.boolean().default(false),
        includeRawPages: z.boolean().default(false)
      },
      outputSchema: noteEngagementOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) =>
      tools.getNoteEngagement(
        args.note_id ?? args.noteId,
        args.reply_limit ?? args.replyLimit,
        args.include_raw_pages ?? args.includeRawPages
      )
  )
  register(
    ['get_subscriber_summary', 'getSubscriberSummary'],
    {
      title: 'Get subscriber analytics',
      description:
        'Get a privacy-safe subscriber count and upstream aggregate fields. Raw subscriber records can contain personal data and are returned only when explicitly requested.',
      inputSchema: {
        include_records: z.boolean().default(false),
        includeRecords: z.boolean().default(false),
        record_limit: rawRowLimit,
        recordLimit: rawRowLimit.optional()
      },
      outputSchema: subscriberSummaryOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) =>
      tools.getSubscriberSummary(
        args.include_records ?? args.includeRecords,
        args.record_limit ?? args.recordLimit
      )
  )
  register(
    ['get_subscriber_stats', 'getSubscriberStats'],
    {
      title: 'Get subscriber stats',
      description:
        'Get publication subscriber statistics or delivery-derived stats if subscriber-stats is unavailable.',
      outputSchema: subscriberStatsOutputSchema,
      annotations: readOnlyAnnotations
    },
    () => tools.getSubscriberStats()
  )
  register(
    ['get_activity', 'getActivity'],
    {
      title: 'Get Substack activity',
      description: 'Get bounded authenticated activity for all events, replies and mentions, or restacks.',
      inputSchema: { filter: activityFilter, limit },
      outputSchema: activityOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) => tools.getActivity(args.filter, args.limit)
  )
  register(
    ['get_unread_activity', 'getUnreadActivity'],
    {
      title: 'Get unread Substack activity',
      description: 'Get bounded unread authenticated activity plus unread-count metadata.',
      inputSchema: { limit },
      outputSchema: unreadActivityOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) => tools.getUnreadActivity(args.limit)
  )
  register(
    ['analyze_content', 'analyzeContent'],
    {
      title: 'Analyze one post',
      description:
        'Return complete author and content engagement analytics for one post without comment or raw-response payloads.',
      inputSchema: {
        post_id: id.optional(),
        postId: id.optional()
      },
      outputSchema: analyzeContentOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) => tools.analyzeContent(args.post_id ?? args.postId)
  )
  register(
    ['get_growth_sources', 'getGrowthSources'],
    {
      title: 'Get growth and traffic sources',
      description:
        'Get historical breakdown of publication traffic, subscriber acquisition, and revenue by referrer / growth channel over a date range. Supports granularity: "total" (default 1-shot aggregate), "week" (weekly trend lines), "day" (daily trend lines, max 31 days), or "month" (monthly trend lines).',
      inputSchema: {
        from_date: date.optional(),
        fromDate: date.optional(),
        to_date: date.optional(),
        toDate: date.optional(),
        order_by: growthSourcesOrderBy.optional(),
        orderBy: growthSourcesOrderBy.optional(),
        order_direction: orderDirection.optional(),
        orderDirection: orderDirection.optional(),
        granularity: growthSourcesGranularity.optional()
      },
      outputSchema: growthSourcesOutputSchema,
      annotations: readOnlyAnnotations
    },
    (args: any) =>
      tools.getGrowthSources({
        fromDate: args.from_date ?? args.fromDate,
        toDate: args.to_date ?? args.toDate,
        orderBy: args.order_by ?? args.orderBy ?? 'users',
        orderDirection: args.order_direction ?? args.orderDirection ?? 'desc',
        granularity: args.granularity ?? 'total'
      })
  )

  return server
}

export function clientFromEnvironment(env: Record<string, string | undefined>): SubstackClient {
  const sessionToken = env.SUBSTACK_SESSION_TOKEN?.trim()
  const publicationUrl = env.SUBSTACK_PUBLICATION_URL?.trim()
  if (!sessionToken || !publicationUrl) {
    throw new SubstackConfigurationError(
      'SUBSTACK_SESSION_TOKEN and SUBSTACK_PUBLICATION_URL are required.'
    )
  }
  return new SubstackClient({ sessionToken, publicationUrl })
}
