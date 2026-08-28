import { describe, expect, test } from 'bun:test'
import {
  SubstackApiError,
  SubstackConfigurationError,
  clientFromEnvironment,
  createMcpServer,
  createToolHandlers
} from '../src/index.js'

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
  getNotes: async () => ({
    items: [
      { comment: { id: 1, body: 'First Note', date: '2026-08-01T10:00:00Z' } },
      { comment: { id: 2, body: 'Second Note', date: '2026-08-02T10:00:00Z' } }
    ]
  }),
  getProfileNotes: async () => ({
    items: [
      { comment: { id: 3, body: 'Third Note', date: '2026-08-03T10:00:00Z' } },
      { comment: { id: 4, body: 'Fourth Note', date: '2026-08-04T10:00:00Z' } }
    ]
  }),
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
  getGrowthSources: async () => ({
    sourceMetrics: [{ source: 'substack', sourceName: 'Substack' }],
    totals: [{ name: 'traffic', total: 149 }]
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
      data: {
        items: [{ id: 1, body: 'First Note', created_at: '2026-08-01T10:00:00Z' }],
        returned: 1,
        pages_fetched: 1,
        complete: true,
        has_more: false,
        cursor: null
      }
    })
    expect((await tools.getProfileNotes(7, undefined, 1)).structuredContent).toEqual({
      data: {
        items: [{ id: 3, body: 'Third Note', created_at: '2026-08-03T10:00:00Z' }],
        returned: 1,
        pages_fetched: 1,
        complete: true,
        has_more: false,
        cursor: null
      }
    })
  })

  test('fetches every profile Note page, normalizes bodies, and deduplicates IDs', async () => {
    const cursors: Array<string | undefined> = []
    const tools = createToolHandlers(
      mockClient({
        getProfileNotes: async (_profileId: number, options: { cursor?: string }) => {
          cursors.push(options.cursor)
          return options.cursor
            ? {
                items: [
                  { comment: { id: 2, body: 'Duplicate' } },
                  { comment: { id: 3, body: 'Final body' } }
                ],
                nextCursor: null
              }
            : {
                items: [
                  { comment: { id: 1, body: 'First body' } },
                  { comment: { id: 2, body: 'Second body' } }
                ],
                nextCursor: 'page-2'
              }
        }
      }) as never
    )

    const result = await tools.getProfileNotes(7, undefined, 10, true, 500)

    expect(cursors).toEqual([undefined, 'page-2'])
    expect(result.structuredContent).toEqual({
      data: {
        items: [
          { id: 1, body: 'First body' },
          { id: 2, body: 'Second body' },
          { id: 3, body: 'Final body' }
        ],
        returned: 3,
        pages_fetched: 2,
        complete: true,
        has_more: false,
        cursor: null
      }
    })
    expect(JSON.parse(result.content[0].text)).toEqual({
      data: {
        items: [
          { id: 1, body: 'First body' },
          { id: 2, body: 'Second body' },
          { id: 3, body: 'Final body' }
        ],
        returned: 3,
        pages_fetched: 2,
        complete: true,
        has_more: false,
        cursor: null
      }
    })
  })

  test('stops fetch-all collection at max_items with a resumable cursor', async () => {
    const tools = createToolHandlers(
      mockClient({
        getProfileNotes: async (
          _profileId: number,
          options: { cursor?: string; limit?: number }
        ) => {
          const start = options.cursor === 'page-2' ? 41 : 1
          const count = options.cursor === 'page-2' ? options.limit ?? 10 : 40
          return {
            items: Array.from({ length: count }, (_, index) => ({
              comment: { id: start + index, body: `Note ${start + index}` }
            })),
            nextCursor: options.cursor === 'page-2' ? 'page-3' : 'page-2'
          }
        }
      }) as never
    )

    const result = await tools.getProfileNotes(7, undefined, 10, true, 50)

    expect(result.structuredContent).toMatchObject({
      data: {
        returned: 50,
        pages_fetched: 2,
        complete: false,
        has_more: true,
        cursor: 'page-3'
      }
    })
  })

  test('prunes raw Note and activity metadata from AI-facing responses', async () => {
    const tools = createToolHandlers(
      mockClient({
        getProfileNotes: async () => ({
          items: [
            {
              entity_key: 'c-9',
              context: { timestamp: '2026-08-28T10:00:00Z', page_rank: 1 },
              comment: {
                id: 9,
                body: 'Important body',
                tracking_parameters: { large: 'discard me' },
                attachments: [{ type: 'image', url: 'https://example.com/image.png' }]
              },
              trackingParameters: { large: 'discard me too' }
            },
            {
              comment: {
                id: 10,
                body: '',
                attachments: [
                  {
                    id: 'image-1',
                    type: 'image',
                    url: 'https://example.com/image.png',
                    publication: { theme: { large: 'discard me' } }
                  }
                ]
              }
            }
          ],
          publications: [{ theme: { large: true } }]
        }),
        getActivity: async () => ({
          activityItems: [
            {
              id: 'activity-1',
              type: 'mention',
              created_at: '2026-08-28T10:00:00Z',
              trackingParams: { large: 'discard me' }
            }
          ],
          users: [{ bio: 'discard me' }],
          posts: [{ body_html: 'discard me' }],
          more: true
        })
      }) as never
    )

    const notes = await tools.getProfileNotes(7, undefined, 10)
    const activity = await tools.getActivity('all', 10)

    expect(notes.structuredContent).toEqual({
      data: {
        items: [
          { id: 9, body: 'Important body', created_at: '2026-08-28T10:00:00Z' },
          {
            id: 10,
            body: '',
            attachments: [
              { id: 'image-1', type: 'image', url: 'https://example.com/image.png' }
            ]
          }
        ],
        returned: 2,
        pages_fetched: 1,
        complete: true,
        has_more: false,
        cursor: null
      }
    })
    expect(activity.structuredContent).toEqual({
      data: {
        activityItems: [
          { id: 'activity-1', type: 'mention', created_at: '2026-08-28T10:00:00Z' }
        ],
        more: true
      }
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
        summary: { engagement_rate: 0.4 },
        breakdowns: {
          byAudience: { paid: 1 },
          bySection: {},
          byType: { podcast: 1 }
        },
        top_metric: 'clicks',
        top_posts: [
          {
            post_id: 2,
            title: 'Second',
            post_date: '2026-02-01T10:00:00Z',
            clicks: 12
          }
        ],
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
        stats: { delivered: 100, opens: 50, links: [['https://example.com', 4]] },
        engagement: {
          content: { visibleCommentCount: 2 },
          management: {
            reaction_count: 8,
            reactions: undefined,
            comment_count: 3,
            reply_count: 2
          }
        },
        comments: [{ id: 10 }],
        comments_returned: 1,
        visible_comment_count: 2
      }
    })
  })

  test('uses complete post analytics for compact content analysis', async () => {
    const result = await createToolHandlers(mockClient() as never).analyzeContent(1)
    const data = result.structuredContent?.data as Record<string, unknown>

    expect(data).toMatchObject({
      post_id: 1,
      title: 'Post',
      performance: { delivered: 100, opens: 50 },
      engagement: {
        content: { visibleCommentCount: 2 },
        management: { reaction_count: 8, comment_count: 3, reply_count: 2 }
      }
    })
    expect(data).not.toHaveProperty('raw')
  })

  test('returns normalized Note engagement and caps reply payloads', async () => {
    const result = await createToolHandlers(mockClient() as never).getNoteEngagement(5, 1, false)

    expect(result.structuredContent).toEqual({
      data: {
        item: { id: 5, body: '' },
        engagement: {
          reactionCount: 9,
          restackCount: 2,
          directReplyCount: 2,
          nestedReplyCount: 1,
          totalReplyCount: 3,
          replyCountsComplete: true
        },
        reply_pages_fetched: 2,
        replies: [{ id: 6 }],
        replies_returned: 1
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
      count: 2,
      records_returned_by_upstream: 2,
      aggregates: { total: 2, has_more: false },
      available_record_fields: ['user_email_address', 'user_id'],
      personal_data_included: false
    })
    expect(safe).not.toHaveProperty('subscribers')
    expect(optedIn).toMatchObject({
      count: 2,
      personal_data_included: true,
      subscribers: [{ user_id: 1, user_email_address: 'one@example.com' }]
    })
  })

  test('returns clean structured content and text for subscriber stats', async () => {
    const tools = createToolHandlers(mockClient() as never)
    const result = await tools.getSubscriberStats()

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({ data: { total_subscribers: 2 } })
    expect(result.content[0].type).toBe('text')
    expect(JSON.parse(result.content[0].text)).toEqual({ data: { total_subscribers: 2 } })
  })

  test('handles errors cleanly in getSubscriberStats tool', async () => {
    const tools = createToolHandlers(
      mockClient({
        getSubscriberStats: async () => {
          throw new Error('Network timeout')
        }
      }) as never
    )
    const result = await tools.getSubscriberStats()

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Network timeout')
  })

  test('returns growth sources structured content from tool handler with snake_case and camelCase args', async () => {
    const tools = createToolHandlers(mockClient() as never)
    const result = await tools.getGrowthSources({
      fromDate: '2026-07-29',
      toDate: '2026-08-27',
      orderBy: 'users'
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({
      data: {
        sourceMetrics: [{ source: 'substack', sourceName: 'Substack' }],
        totals: [{ name: 'traffic', total: 149 }]
      }
    })

    const snakeResult = await tools.getGrowthSources({
      from_date: '2026-03-01',
      to_date: '2026-03-31',
      order_by: 'users'
    })
    expect(snakeResult.isError).toBeUndefined()
    expect(snakeResult.structuredContent).toEqual({
      data: {
        sourceMetrics: [{ source: 'substack', sourceName: 'Substack' }],
        totals: [{ name: 'traffic', total: 149 }]
      }
    })
  })

  test('rejects an inverted growth sources date range', async () => {
    const tools = createToolHandlers(mockClient() as never)
    const result = await tools.getGrowthSources({
      fromDate: '2026-08-27',
      toDate: '2026-07-29'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('fromDate cannot be after toDate')

    const snakeInverted = await tools.getGrowthSources({
      from_date: '2026-08-27',
      to_date: '2026-07-29'
    })
    expect(snakeInverted.isError).toBe(true)
    expect(snakeInverted.content[0].text).toContain('fromDate cannot be after toDate')
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

  test('registers both snake_case and camelCase aliases for all tools', () => {
    const server = createMcpServer(mockClient() as never)
    const registeredTools = Object.keys((server as any)._registeredTools ?? {})
    expect(registeredTools).toContain('get_notes')
    expect(registeredTools).toContain('getNotes')
    expect(registeredTools).toContain('get_profile_notes')
    expect(registeredTools).toContain('getProfileNotes')
    expect(registeredTools).toContain('get_authenticated_profile')
    expect(registeredTools).toContain('getAuthenticatedProfile')
    expect(registeredTools).toContain('get_recent_posts')
    expect(registeredTools).toContain('getRecentPosts')
    expect(registeredTools).toContain('get_email_stats')
    expect(registeredTools).toContain('getEmailStats')
    expect(registeredTools).toContain('get_publication_analytics')
    expect(registeredTools).toContain('getPublicationAnalytics')
    expect(registeredTools).toContain('get_post_engagement')
    expect(registeredTools).toContain('getPostEngagement')
    expect(registeredTools).toContain('get_post_analytics')
    expect(registeredTools).toContain('getPostAnalytics')
    expect(registeredTools).toContain('get_note_engagement')
    expect(registeredTools).toContain('getNoteEngagement')
    expect(registeredTools).toContain('get_subscriber_summary')
    expect(registeredTools).toContain('getSubscriberSummary')
    expect(registeredTools).toContain('get_subscriber_stats')
    expect(registeredTools).toContain('getSubscriberStats')
    expect(registeredTools).toContain('get_activity')
    expect(registeredTools).toContain('getActivity')
    expect(registeredTools).toContain('get_unread_activity')
    expect(registeredTools).toContain('getUnreadActivity')
    expect(registeredTools).toContain('analyze_content')
    expect(registeredTools).toContain('analyzeContent')
    expect(registeredTools).toContain('get_growth_sources')
    expect(registeredTools).toContain('getGrowthSources')
  })

  test('requires both environment variables', () => {
    expect(() => clientFromEnvironment({})).toThrow(SubstackConfigurationError)
  })
})
