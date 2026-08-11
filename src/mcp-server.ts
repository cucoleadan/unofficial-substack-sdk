import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  SubstackApiError,
  SubstackClient,
  SubstackConfigurationError,
  type EmailStatsOptions,
  type EmailStatsRow
} from './index.js'

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
const emailRowLimit = z.number().int().min(1).max(20).default(20)
const rawRowLimit = z.number().int().min(1).max(200).default(20)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const orderDirection = z.enum(['asc', 'desc']).default('desc')
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

const outputSchema = { data: z.unknown() }

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
    'post_date',
    'audience',
    'type',
    'wordcount'
  ]
  return Object.fromEntries(keys.filter((key) => post[key] !== undefined).map((key) => [key, post[key]]))
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
    averageRates: averages,
    breakdowns: {
      byAudience: dimensionCounts(rows, 'audience'),
      bySection: dimensionCounts(rows, 'section_name'),
      byType: dimensionCounts(rows, 'type')
    },
    topPosts: { metric: topMetric, posts: topPosts },
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

export function createToolHandlers(client: ReadOnlyClient) {
  const run = async (work: () => Promise<unknown>) => {
    try {
      return result(await work())
    } catch (error) {
      return failure(error)
    }
  }

  const getPostAnalytics = (
    postId: string | number,
    commentLimit = 20,
    includeRaw = false
  ) =>
    run(async () => {
      const [postResult, managementDetail] = await Promise.all([
        client.getPostWithEngagement(postId),
        client.getPostManagementDetail(postId)
      ])
      const managementPost = Array.isArray(managementDetail.posts)
        ? managementDetail.posts.find((post) => String(post.id) === String(postId)) ?? managementDetail.posts[0]
        : undefined

      return {
        post: compactPost(postResult.post),
        analytics: managementPost?.stats,
        contentEngagement: postResult.engagement,
        managementEngagement: managementPost
          ? {
              reactionCount: managementPost.reaction_count,
              reactions: managementPost.reactions,
              commentCount: managementPost.comment_count,
              replyCount: managementPost.child_comment_count
            }
          : undefined,
        comments: postResult.commentItems.slice(0, commentLimit),
        commentsReturned: Math.min(commentLimit, postResult.commentItems.length),
        visibleCommentCount: postResult.commentItems.length,
        ...(includeRaw ? { raw: { post: postResult.post, managementDetail } } : {})
      }
    })

  return {
    getAuthenticatedProfile: () => run(() => client.getAuthenticatedProfile()),
    getRecentPosts: (profileId: string | number, maximum = 20) =>
      run(async () => capped(await client.getProfilePosts(profileId, { limit: maximum }), maximum)),
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
        return { post, engagement, comments: commentItems.slice(0, maximum) }
      }),
    getPostAnalytics,
    getNotes: (cursor: string | undefined, maximum = 20) =>
      run(async () => capped(await client.getNotes({ cursor }), maximum)),
    getProfileNotes: (profileId: string | number, cursor: string | undefined, maximum = 20) =>
      run(async () => capped(await client.getProfileNotes(profileId, { cursor }), maximum)),
    getNoteEngagement: (
      noteId: string | number,
      maximum = 20,
      includeRawPages = false
    ) =>
      run(async () => {
        const noteResult = await client.getNoteWithEngagement(noteId)
        return {
          note: noteResult.note.item,
          engagement: noteResult.engagement,
          replyPagesFetched: noteResult.replyPages.length,
          replies: noteResult.replies.slice(0, maximum),
          repliesReturned: Math.min(maximum, noteResult.replies.length),
          ...(includeRawPages ? { rawReplyPages: noteResult.replyPages } : {})
        }
      }),
    getSubscriberSummary: (includeRecords = false, maximum = 20) =>
      run(async () => {
        const response = await client.getSubscriberStats<Record<string, unknown>>()
        const record = isRecord(response) ? response : {}
        const subscribers = Array.isArray(response.subscribers) ? response.subscribers : []
        return {
          subscriberCount: subscriberCount(record, subscribers),
          recordsReturnedByUpstream: subscribers.length,
          upstreamAggregates: safeSubscriberMetadata(record),
          availableRecordFields: [
            ...new Set(
              subscribers.flatMap((subscriber) => (isRecord(subscriber) ? Object.keys(subscriber) : []))
            )
          ].sort(),
          personalDataIncluded: includeRecords,
          ...(includeRecords ? { subscribers: subscribers.slice(0, maximum) } : {})
        }
      }),
    getActivity: (filter: 'all' | 'replies-and-mentions' | 'restacks', maximum = 20) =>
      run(async () => capped(await client.getActivity(filter), maximum)),
    getUnreadActivity: (maximum = 20) =>
      run(async () => capped(await client.getUnreadActivity(), maximum)),
    analyzeContent: (postId: string | number) => getPostAnalytics(postId, 0, false)
  }
}

export function createMcpServer(client: ReadOnlyClient): McpServer {
  const server = new McpServer({ name: 'substack-mcp', version: '0.3.4' })
  const tools = createToolHandlers(client)

  server.registerTool(
    'get_authenticated_profile',
    {
      title: 'Get authenticated Substack profile',
      description: 'Get the authenticated profile, including the profile ID needed by profile tools.',
      outputSchema,
      annotations: readOnlyAnnotations
    },
    () => tools.getAuthenticatedProfile()
  )
  server.registerTool(
    'get_recent_posts',
    {
      title: 'Get recent posts',
      description: 'Get recent posts for a Substack profile.',
      inputSchema: { profile_id: id, limit },
      outputSchema,
      annotations: readOnlyAnnotations
    },
    ({ profile_id, limit }) => tools.getRecentPosts(profile_id, limit)
  )
  server.registerTool(
    'get_email_stats',
    {
      title: 'Get one email statistics page',
      description:
        'Get one fixed 20-row Substack email-stat page. Limit caps the returned rows but not the upstream page size.',
      inputSchema: {
        offset: z.number().int().nonnegative().default(0),
        limit: emailRowLimit,
        order_by: z.string().min(1).default('post_date'),
        order_direction: orderDirection
      },
      outputSchema,
      annotations: readOnlyAnnotations
    },
    ({ offset, limit, order_by, order_direction }) =>
      tools.getEmailStats({ offset, orderBy: order_by, orderDirection: order_direction }, limit)
  )
  server.registerTool(
    'get_publication_analytics',
    {
      title: 'Analyze publication performance',
      description:
        'Analyze all publication email-stat history with totals, average upstream rates, breakdowns, top posts, and optional bounded raw rows.',
      inputSchema: {
        offset: z.number().int().nonnegative().default(0),
        from_date: date.optional(),
        to_date: date.optional(),
        order_by: z.string().min(1).default('post_date'),
        order_direction: orderDirection,
        top_metric: z.enum(topMetrics).default('engagement_rate'),
        top_limit: z.number().int().min(1).max(50).default(10),
        include_rows: z.boolean().default(false),
        row_limit: rawRowLimit
      },
      outputSchema,
      annotations: readOnlyAnnotations
    },
    ({
      offset,
      from_date,
      to_date,
      order_by,
      order_direction,
      top_metric,
      top_limit,
      include_rows,
      row_limit
    }) =>
      tools.getPublicationAnalytics({
        offset,
        fromDate: from_date,
        toDate: to_date,
        orderBy: order_by,
        orderDirection: order_direction,
        topMetric: top_metric,
        topLimit: top_limit,
        includeRows: include_rows,
        rowLimit: row_limit
      })
  )
  server.registerTool(
    'get_post_engagement',
    {
      title: 'Get post engagement',
      description: 'Get a post, its visible comments, and content engagement totals.',
      inputSchema: { post_id: id, comment_limit: limit },
      outputSchema,
      annotations: readOnlyAnnotations
    },
    ({ post_id, comment_limit }) => tools.getPostEngagement(post_id, comment_limit)
  )
  server.registerTool(
    'get_post_analytics',
    {
      title: 'Get complete post analytics',
      description:
        'Combine author analytics with visible post and comment engagement, including delivery, conversion, media, link, referrer, daily, and comparison data when available.',
      inputSchema: {
        post_id: id,
        comment_limit: limit,
        include_raw: z.boolean().default(false)
      },
      outputSchema,
      annotations: readOnlyAnnotations
    },
    ({ post_id, comment_limit, include_raw }) =>
      tools.getPostAnalytics(post_id, comment_limit, include_raw)
  )
  server.registerTool(
    'get_notes',
    {
      title: 'Get publication Notes',
      description: 'Get a bounded page of authenticated publication Notes.',
      inputSchema: { cursor: z.string().optional(), limit },
      outputSchema,
      annotations: readOnlyAnnotations
    },
    ({ cursor, limit }) => tools.getNotes(cursor, limit)
  )
  server.registerTool(
    'get_profile_notes',
    {
      title: 'Get profile Notes',
      description: 'Get a bounded profile Notes page with raw per-Note engagement fields.',
      inputSchema: { profile_id: id, cursor: z.string().optional(), limit },
      outputSchema,
      annotations: readOnlyAnnotations
    },
    ({ profile_id, cursor, limit }) => tools.getProfileNotes(profile_id, cursor, limit)
  )
  server.registerTool(
    'get_note_engagement',
    {
      title: 'Get complete Note engagement',
      description:
        'Get Note reactions, restacks, viewer state, and fully paginated visible direct, nested, and total reply counts. Note views are returned only if Substack supplies them.',
      inputSchema: {
        note_id: id,
        reply_limit: limit,
        include_raw_pages: z.boolean().default(false)
      },
      outputSchema,
      annotations: readOnlyAnnotations
    },
    ({ note_id, reply_limit, include_raw_pages }) =>
      tools.getNoteEngagement(note_id, reply_limit, include_raw_pages)
  )
  server.registerTool(
    'get_subscriber_summary',
    {
      title: 'Get subscriber analytics',
      description:
        'Get a privacy-safe subscriber count and upstream aggregate fields. Raw subscriber records can contain personal data and are returned only when explicitly requested.',
      inputSchema: {
        include_records: z.boolean().default(false),
        record_limit: rawRowLimit
      },
      outputSchema,
      annotations: readOnlyAnnotations
    },
    ({ include_records, record_limit }) => tools.getSubscriberSummary(include_records, record_limit)
  )
  server.registerTool(
    'get_activity',
    {
      title: 'Get Substack activity',
      description: 'Get bounded authenticated activity for all events, replies and mentions, or restacks.',
      inputSchema: { filter: activityFilter, limit },
      outputSchema,
      annotations: readOnlyAnnotations
    },
    ({ filter, limit }) => tools.getActivity(filter, limit)
  )
  server.registerTool(
    'get_unread_activity',
    {
      title: 'Get unread Substack activity',
      description: 'Get bounded unread authenticated activity plus unread-count metadata.',
      inputSchema: { limit },
      outputSchema,
      annotations: readOnlyAnnotations
    },
    ({ limit }) => tools.getUnreadActivity(limit)
  )
  server.registerTool(
    'analyze_content',
    {
      title: 'Analyze one post',
      description:
        'Return complete author and content engagement analytics for one post without comment or raw-response payloads.',
      inputSchema: { post_id: id },
      outputSchema,
      annotations: readOnlyAnnotations
    },
    ({ post_id }) => tools.analyzeContent(post_id)
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
