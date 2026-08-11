import { describe, expect, test } from 'bun:test'
import { SubstackApiError, SubstackConfigurationError } from '../src/index.js'
import { clientFromEnvironment, createMcpServer, createToolHandlers } from '../src/mcp-server.js'

const mockClient = (overrides: Record<string, unknown> = {}) => ({
  getAuthenticatedProfile: async () => ({ id: 7, handle: 'writer' }),
  getProfilePosts: async () => ({ posts: [{ id: 1 }, { id: 2 }] }),
  getEmailStats: async () => ({ rows: [{ post_id: 1 }, { post_id: 2 }] }),
  getAllEmailStats: async () => [
    {
      post_id: 1,
      title: 'First',
      post_date: '2026-01-01T10:00:00Z',
      audience: 'everyone',
      type: 'newsletter',
      delivered: 100,
      opens: 50,
      clicks: 10,
      engagement_rate: 0.5,
      subscribes: 2
    },
    {
      post_id: 2,
      title: 'Second',
      post_date: '2026-02-01T10:00:00Z',
      audience: 'paid',
      type: 'podcast',
      delivered: 200,
      opens: 80,
      clicks: 12,
      engagement_rate: 0.4,
      subscribes: 3,
      podcast_preview_downloads: '25'
    }
  ],
  getPostManagementDetail: async () => ({
    posts: [
      {
        id: 1,
        reaction_count: 8,
        comment_count: 3,
        child_comment_count: 2,
        stats: { delivered: 100, opens: 50, links: [['https://example.com', 4]] }
      }
    ]
  }),
  getPostWithEngagement: async () => ({
    post: { id: 1, title: 'Post', subtitle: 'Subtitle', body_html: '<p>Large body</p>' },
    comments: [],
    commentItems: [{ id: 10 }, { id: 11 }],
    engagement: { visibleCommentCount: 2 }
  }),
  getNotes: async () => ({ items: [{ id: 1 }, { id: 2 }] }),
  getProfileNotes: async () => ({ items: [{ id: 3 }, { id: 4 }] }),
  getNoteWithEngagement: async () => ({
    note: { item: { comment: { id: 5, reaction_count: 9, restacks: 2 } } },
    replyPages: [{ commentBranches: [] }, { commentBranches: [] }],
    replies: [{ comment: { id: 6 } }, { comment: { id: 7 } }],
    engagement: {
      reactionCount: 9,
      restackCount: 2,
      directReplyCount: 2,
      nestedReplyCount: 1,
      totalReplyCount: 3,
      replyCountsComplete: true
    }
  }),
  getSubscriberStats: async () => ({
    total: 2,
    has_more: false,
    publication_name: 'Private publication metadata',
    subscribers: [
      { user_id: 1, user_email_address: 'one@example.com' },
      { user_id: 2, user_email_address: 'two@example.com' }
    ]
  }),
  getActivity: async () => ({ activityItems: [{ id: 1 }, { id: 2 }] }),
  getUnreadActivity: async () => ({
    activityItems: [{ id: 1 }, { id: 2 }],
    unread: { count: 2, strategy: 'latest-activity-items' }
  }),
  ...overrides
})

describe('MCP tools', () => {
  test('constructs the expanded MCP server', () => {
    expect(() => createMcpServer(mockClient() as never)).not.toThrow()
  })

  test('returns capped structured data from SDK responses', async () => {
    const tools = createToolHandlers(mockClient() as never)

    expect((await tools.getRecentPosts(7, 1)).structuredContent).toEqual({
      data: { posts: [{ id: 1 }] }
    })
    expect((await tools.getEmailStats({}, 1)).structuredContent).toEqual({
      data: { rows: [{ post_id: 1 }] }
    })
    expect((await tools.getNotes(undefined, 1)).structuredContent).toEqual({
      data: { items: [{ id: 1 }] }
    })
    expect((await tools.getProfileNotes(7, undefined, 1)).structuredContent).toEqual({
      data: { items: [{ id: 3 }] }
    })
  })

  test('summarizes complete publication history with filters and bounded rows', async () => {
    const result = await createToolHandlers(mockClient() as never).getPublicationAnalytics({
      fromDate: '2026-02-01',
      topMetric: 'clicks',
      includeRows: true,
      rowLimit: 1
    })

    expect(result.structuredContent).toEqual({
      data: {
        sourceRowsFetched: 2,
        filters: {
          offset: 0,
          fromDate: '2026-02-01',
          toDate: undefined
        },
        rowsAnalyzed: 1,
        dateRange: {
          from: '2026-02-01T10:00:00Z',
          to: '2026-02-01T10:00:00Z'
        },
        totals: {
          delivered: 200,
          opens: 80,
          clicks: 12,
          subscribes: 3,
          podcast_preview_downloads: 25
        },
        averageRates: { engagement_rate: 0.4 },
        breakdowns: {
          byAudience: { paid: 1 },
          bySection: {},
          byType: { podcast: 1 }
        },
        topPosts: {
          metric: 'clicks',
          posts: [
            {
              post_id: 2,
              title: 'Second',
              post_date: '2026-02-01T10:00:00Z',
              clicks: 12
            }
          ]
        },
        availableFields: [
          'audience',
          'clicks',
          'delivered',
          'engagement_rate',
          'opens',
          'podcast_preview_downloads',
          'post_date',
          'post_id',
          'subscribes',
          'title',
          'type'
        ],
        rows: [expect.objectContaining({ post_id: 2 })]
      }
    })
  })

  test('rejects an inverted publication analytics date range', async () => {
    const result = await createToolHandlers(mockClient() as never).getPublicationAnalytics({
      fromDate: '2026-03-01',
      toDate: '2026-02-01'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('fromDate cannot be after toDate')
  })

  test('combines management and visible engagement for complete post analytics', async () => {
    const result = await createToolHandlers(mockClient() as never).getPostAnalytics(1, 1, false)

    expect(result.structuredContent).toEqual({
      data: {
        post: { id: 1, title: 'Post', subtitle: 'Subtitle' },
        analytics: { delivered: 100, opens: 50, links: [['https://example.com', 4]] },
        contentEngagement: { visibleCommentCount: 2 },
        managementEngagement: {
          reactionCount: 8,
          reactions: undefined,
          commentCount: 3,
          replyCount: 2
        },
        comments: [{ id: 10 }],
        commentsReturned: 1,
        visibleCommentCount: 2
      }
    })
  })

  test('uses complete post analytics for compact content analysis', async () => {
    const result = await createToolHandlers(mockClient() as never).analyzeContent(1)
    const data = result.structuredContent?.data as Record<string, unknown>

    expect(data).toMatchObject({
      post: { id: 1, title: 'Post', subtitle: 'Subtitle' },
      analytics: { delivered: 100, opens: 50 },
      contentEngagement: { visibleCommentCount: 2 },
      comments: [],
      commentsReturned: 0
    })
    expect(data).not.toHaveProperty('raw')
  })

  test('returns normalized Note engagement and caps reply payloads', async () => {
    const result = await createToolHandlers(mockClient() as never).getNoteEngagement(5, 1, false)

    expect(result.structuredContent).toEqual({
      data: {
        note: { comment: { id: 5, reaction_count: 9, restacks: 2 } },
        engagement: {
          reactionCount: 9,
          restackCount: 2,
          directReplyCount: 2,
          nestedReplyCount: 1,
          totalReplyCount: 3,
          replyCountsComplete: true
        },
        replyPagesFetched: 2,
        replies: [{ comment: { id: 6 } }],
        repliesReturned: 1
      }
    })
  })

  test('redacts subscriber records by default and only returns them on explicit opt-in', async () => {
    const tools = createToolHandlers(mockClient() as never)
    const safe = (await tools.getSubscriberSummary()).structuredContent?.data as Record<string, unknown>
    const optedIn = (await tools.getSubscriberSummary(true, 1)).structuredContent?.data as Record<
      string,
      unknown
    >

    expect(safe).toEqual({
      subscriberCount: 2,
      recordsReturnedByUpstream: 2,
      upstreamAggregates: { total: 2, has_more: false },
      availableRecordFields: ['user_email_address', 'user_id'],
      personalDataIncluded: false
    })
    expect(safe).not.toHaveProperty('subscribers')
    expect(optedIn).toMatchObject({
      subscriberCount: 2,
      personalDataIncluded: true,
      subscribers: [{ user_id: 1, user_email_address: 'one@example.com' }]
    })
  })

  test('caps activity while retaining unread metadata', async () => {
    const tools = createToolHandlers(mockClient() as never)

    expect((await tools.getActivity('restacks', 1)).structuredContent).toEqual({
      data: { activityItems: [{ id: 1 }] }
    })
    expect((await tools.getUnreadActivity(1)).structuredContent).toEqual({
      data: {
        activityItems: [{ id: 1 }],
        unread: { count: 2, strategy: 'latest-activity-items' }
      }
    })
  })

  test('turns authentication failures into friendly tool errors', async () => {
    const tools = createToolHandlers(
      mockClient({
        getEmailStats: async () => {
          throw new SubstackApiError('Request failed.', 401, 'https://example.com')
        }
      }) as never
    )
    const response = await tools.getEmailStats({})

    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain('authentication failed')
  })

  test('requires both environment variables', () => {
    expect(() => clientFromEnvironment({})).toThrow(SubstackConfigurationError)
  })
})
