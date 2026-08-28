import { describe, expect, test } from 'bun:test'

import {
  apiBase,
  createNoteBodyJson,
  type EmailStatsRow,
  type NoteEngagement,
  type PostManagementDetail,
  SubstackApiError,
  SubstackClient,
  SubstackConfigurationError
} from '../src/core/index.js'

describe('apiBase', () => {
  test('normalizes origins and removes copied browser URL details', () => {
    expect(
      apiBase('https://allagentsconsidered.substack.com/some-path/?utm_campaign=profile#top')
    ).toBe('https://allagentsconsidered.substack.com/some-path/api/v1/')
  })

  test('rejects empty origins and prefixes', () => {
    expect(() => apiBase('')).toThrow(SubstackConfigurationError)
    expect(() => apiBase('https://substack.com', '/')).toThrow(SubstackConfigurationError)
  })

  test('accepts HTTPS custom publication origins and rejects insecure ones', () => {
    expect(apiBase('https://newsletter.example.com')).toBe('https://newsletter.example.com/api/v1/')
    expect(apiBase('https://newsletter.example.com:8443')).toBe('https://newsletter.example.com:8443/api/v1/')
    expect(() => apiBase('http://substack.com')).toThrow(SubstackConfigurationError)
  })
})

describe('SubstackClient', () => {
  test('sends Web-standard authenticated requests to global endpoints', async () => {
    let request: Request | undefined
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json({ post: { id: 123 } })
      }
    })

    await client.getPost(123)

    expect(request?.url).toBe('https://substack.com/api/v1/posts/by-id/123')
    expect(request?.headers.get('accept')).toBe('application/json')
    expect(request?.headers.get('cookie')).toBe('substack.sid=session-value')
    expect(request?.redirect).toBe('error')
  })

  test('combines a post and its visible comments with calculated engagement totals', async () => {
    const requests: string[] = []
    const visibleComments = [
      {
        id: 10,
        reaction_count: 2,
        restacks: 1,
        children: [
          {
            id: 11,
            reaction_count: 3,
            restacks: 0,
            children: [{ id: 12, reaction_count: 0, restacks: 2, children: [] }]
          }
        ]
      },
      { id: 13, reaction_count: 5, restacks: 0, children: [] }
    ]
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://newsletter.example.com',
      fetch: async (input) => {
        const url = new Request(input).url
        requests.push(url)
        if (url.endsWith('/posts/by-id/123')) {
          return Response.json({
            post: {
              id: 123,
              reactions: { '❤': 8 },
              reaction_count: 8,
              restacks: 3,
              comment_count: 5,
              child_comment_count: 3
            },
            publication: { id: 99 },
            publicationSettings: { comments_enabled: true }
          })
        }

        return Response.json({
          comments: visibleComments,
          automod_hidden_comments: [{ id: 14, reaction_count: 7, restacks: 4, children: [] }]
        })
      }
    })

    const result = await client.getPostWithEngagement(123)

    expect(requests).toEqual([
      'https://substack.com/api/v1/posts/by-id/123',
      'https://newsletter.example.com/api/v1/post/123/comments'
    ])
    expect(result).toEqual({
      post: {
        id: 123,
        reactions: { '❤': 8 },
        reaction_count: 8,
        restacks: 3,
        comment_count: 5,
        child_comment_count: 3
      },
      publication: { id: 99 },
      publicationSettings: { comments_enabled: true },
      comments: visibleComments,
      commentItems: [
        visibleComments[0],
        visibleComments[0].children[0],
        visibleComments[0].children[0].children[0],
        visibleComments[1]
      ],
      engagement: {
        reactions: { '❤': 8 },
        reactionCount: 8,
        restackCount: 3,
        reportedCommentCount: 5,
        reportedReplyCount: 3,
        visibleRootCommentCount: 2,
        visibleCommentCount: 4,
        visibleReplyCount: 2,
        commentReactionCount: 10,
        commentRestackCount: 3
      }
    })
    expect(result).not.toHaveProperty('automodHiddenComments')
  })

  test('returns automod-hidden comments only when requested', async () => {
    const hiddenComments = [{ id: 14, children: [] }]
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://newsletter.example.com',
      fetch: async (input) => {
        const url = new Request(input).url
        return Response.json(
          url.endsWith('/posts/by-id/123')
            ? { post: { id: 123 } }
            : { comments: [], automod_hidden_comments: hiddenComments }
        )
      }
    })

    await expect(client.getPostWithEngagement(123, { includeAutomodHidden: true })).resolves.toMatchObject({
      comments: [],
      commentItems: [],
      automodHiddenComments: hiddenComments,
      engagement: {
        visibleRootCommentCount: 0,
        visibleCommentCount: 0,
        visibleReplyCount: 0,
        commentReactionCount: 0,
        commentRestackCount: 0
      }
    })
  })

  test('requires a publication URL before requesting combined post engagement', () => {
    let fetchCalled = false
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async () => {
        fetchCalled = true
        return Response.json({})
      }
    })

    expect(() => client.getPostWithEngagement(123)).toThrow(SubstackConfigurationError)
    expect(fetchCalled).toBe(false)
  })

  test('gets typed post-management detail for numeric and string IDs without changing the response', async () => {
    const requests: string[] = []
    const response = {
      posts: [
        {
          id: 123,
          reaction_count: 9,
          comment_count: 2,
          child_comment_count: 1,
          stats: {
            delivered: 500,
            opens: 162,
            clicks: 3,
            likes: 9,
            comments: 2,
            shares: 4,
            restacks: 1,
            views: 169
          }
        }
      ],
      total: 1
    } satisfies PostManagementDetail
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://newsletter.example.com',
      fetch: async (input) => {
        requests.push(new Request(input).url)
        return Response.json(response)
      }
    })

    await expect(client.getPostManagementDetail(123)).resolves.toEqual(response)
    await expect(client.getPostManagementDetail('456')).resolves.toEqual(response)
    expect(requests).toEqual([
      'https://newsletter.example.com/api/v1/post_management/detail/123',
      'https://newsletter.example.com/api/v1/post_management/detail/456'
    ])
    expect(() => client.getPostManagementDetail(0)).toThrow(SubstackConfigurationError)
    expect(() => client.getPostManagementDetail('not-an-id')).toThrow(SubstackConfigurationError)
  })

  test('surfaces post-management upstream errors with the requested URL', async () => {
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://newsletter.example.com',
      fetch: async () => Response.json({ error: 'forbidden' }, { status: 403 })
    })

    await expect(client.getPostManagementDetail(123)).rejects.toMatchObject({
      name: SubstackApiError.name,
      status: 403,
      url: 'https://newsletter.example.com/api/v1/post_management/detail/123',
      detail: '{"error":"forbidden"}'
    })
  })

  test('uses a supplied custom domain for publication-scoped requests', async () => {
    let request: Request | undefined
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://newsletter.example.com',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json({ items: [] })
      }
    })

    await client.getProfileNotes(123)

    expect(request?.url).toBe('https://newsletter.example.com/api/v1/reader/feed/profile/123?types=note')
    expect(request?.headers.get('cookie')).toBe('substack.sid=session-value')
  })

  test('resolves authenticated profile and fetches profile Notes feed', async () => {
    const urls: string[] = []
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://newsletter.example.com',
      fetch: async (input, init) => {
        const req = new Request(input, init)
        urls.push(req.url)
        if (req.url.endsWith('/handle/options')) {
          return Response.json({
            potentialHandles: [{ handle: 'authorhandle', type: 'existing' }]
          })
        }
        if (req.url.includes('/user/authorhandle/public_profile')) {
          return Response.json({ id: 12345, handle: 'authorhandle', name: 'Author Name' })
        }
        return Response.json({ items: [{ comment: { id: 1 } }] })
      }
    })

    const result = await client.getNotes()

    expect(urls).toEqual([
      'https://substack.com/api/v1/handle/options',
      'https://substack.com/api/v1/user/authorhandle/public_profile',
      'https://newsletter.example.com/api/v1/reader/feed/profile/12345?types=note'
    ])
    expect(result.items).toHaveLength(1)
  })

  test('keeps the global receiver when it uses native fetch', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
    let receiver: unknown

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: function (this: unknown): Promise<Response> {
        receiver = this
        return Promise.resolve(Response.json({ post: { id: 1 } }))
      }
    })

    try {
      await new SubstackClient({ sessionToken: 'session-value' }).getPost(1)
      expect(receiver).toBe(globalThis)
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'fetch', descriptor)
      }
    }
  })

  test('fetches Notes with explicit profileId and encodes cursor values', async () => {
    let request: Request | undefined
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com/?utm_campaign=profile_chips',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json({ items: [] })
      }
    })

    await client.getNotes({ profileId: 42, cursor: 'next page', limit: 10 })

    expect(request?.url).toBe(
      'https://allagentsconsidered.substack.com/api/v1/reader/feed/profile/42?types=note&limit=10&cursor=next+page'
    )
  })

  test('returns typed profile Notes without changing the upstream response', async () => {
    let request: Request | undefined
    const response = {
      items: [
        { comment: { id: 1, reaction: '❤', reaction_count: 11, restacks: 3, restacked: true } },
        { comment: { id: 2, reaction_count: 10, children_count: 4 } },
        { context: { type: 'note' } }
      ],
      nextCursor: null
    }
    const passthroughClient = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json(response)
      }
    })

    const page = await passthroughClient.getProfileNotes(7)
    expect(page).toEqual(response)
    expect(page.items?.[0]?.comment?.restacks).toBe(3)
    expect(request?.url).toBe(
      'https://allagentsconsidered.substack.com/api/v1/reader/feed/profile/7?types=note'
    )
  })

  test('gets a typed Note by numeric or string ID without changing the response', async () => {
    const requests: string[] = []
    const response = {
      item: {
        comment: {
          id: 300750684,
          reaction_count: 11,
          children_count: 2,
          restacks: 3,
          reaction: null,
          restacked: false
        }
      }
    }
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://newsletter.example.com',
      fetch: async (input) => {
        requests.push(new Request(input).url)
        return Response.json(response)
      }
    })

    const note = await client.getNote(300750684)
    expect(note).toEqual(response)
    expect(note.item?.comment?.children_count).toBe(2)
    await expect(client.getNote('300750684')).resolves.toEqual(response)
    expect(requests).toEqual([
      'https://newsletter.example.com/api/v1/reader/comment/300750684',
      'https://newsletter.example.com/api/v1/reader/comment/300750684'
    ])
    expect(() => client.getNote(-1)).toThrow(SubstackConfigurationError)
  })

  test('gets Note reply branches through the global reader endpoint', async () => {
    const requests: Request[] = []
    const response = {
      commentBranches: [{ comment: { id: 300751001 }, descendantComments: [] }],
      moreBranches: 0,
      nextCursor: null,
      rootComment: { id: 300750684 },
      automodHiddenBranches: []
    }
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json(response)
      }
    })

    await expect(client.getNoteReplies(300750684)).resolves.toEqual(response)
    await expect(client.getNoteReplies('300750684', { cursor: 'next page' })).resolves.toEqual(response)
    expect(requests.map((request) => request.url)).toEqual([
      'https://substack.com/api/v1/reader/comment/300750684/replies?comment_id=300750684',
      'https://substack.com/api/v1/reader/comment/300750684/replies?comment_id=300750684&cursor=next+page'
    ])
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
    expect(requests[0]?.headers.get('cookie')).toBe('substack.sid=session-value')
    expect(() => client.getNoteReplies(0)).toThrow(SubstackConfigurationError)
  })

  test('calculates complete visible direct and nested Note reply totals across pages', async () => {
    const requests: string[] = []
    const note = {
      item: {
        comment: {
          id: 10,
          reaction: '❤',
          reaction_count: 7,
          children_count: 3,
          restacks: 2,
          restacked: true
        }
      }
    }
    const firstPage = {
      commentBranches: [
        {
          comment: { id: 11, children_count: 2 },
          descendantComments: [{ comment: { id: 12 } }, { comment: { id: 13 } }]
        },
        {
          comment: { id: 14, children_count: 1 },
          descendantComments: [{ comment: { id: 15 } }]
        }
      ],
      moreBranches: 1,
      nextCursor: 'next page',
      rootComment: { id: 10 },
      automodHiddenBranches: []
    }
    const secondPage = {
      commentBranches: [{ comment: { id: 16, children_count: 0 }, descendantComments: [] }],
      moreBranches: 0,
      nextCursor: null,
      rootComment: { id: 10 }
    }
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://newsletter.example.com',
      fetch: async (input) => {
        const url = new Request(input).url
        requests.push(url)
        if (url === 'https://newsletter.example.com/api/v1/reader/comment/10') {
          return Response.json(note)
        }
        return Response.json(url.includes('cursor=next+page') ? secondPage : firstPage)
      }
    })

    const result = await client.getNoteWithEngagement('10')
    const engagement: NoteEngagement = result.engagement

    expect(requests).toEqual([
      'https://newsletter.example.com/api/v1/reader/comment/10',
      'https://substack.com/api/v1/reader/comment/10/replies?comment_id=10',
      'https://substack.com/api/v1/reader/comment/10/replies?comment_id=10&cursor=next+page'
    ])
    expect(result.note).toEqual(note)
    expect(result.replyPages).toEqual([firstPage, secondPage])
    expect(result.replies.map((branch) => branch.comment?.id)).toEqual([11, 14, 16])
    expect(engagement).toEqual({
      reactionCount: 7,
      reportedDirectReplyCount: 3,
      directReplyCount: 3,
      nestedReplyCount: 3,
      totalReplyCount: 6,
      restackCount: 2,
      viewerHasLiked: true,
      viewerHasRestacked: true,
      replyCountsComplete: true
    })
    expect(engagement).not.toHaveProperty('viewCount')
  })

  test('omits unreliable Note totals when optional reply structures are missing', async () => {
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://newsletter.example.com',
      fetch: async (input) => Response.json(
        new Request(input).url.includes('/replies')
          ? { commentBranches: [{ comment: { id: 2 } }], nextCursor: null }
          : { item: { comment: { id: 1, reaction: null, restacked: false } } }
      )
    })

    const result = await client.getNoteWithEngagement(1)
    expect(result.engagement).toMatchObject({
      viewerHasLiked: false,
      viewerHasRestacked: false,
      replyCountsComplete: false
    })
    expect(result.engagement).not.toHaveProperty('reactionCount')
    expect(result.engagement).not.toHaveProperty('directReplyCount')
    expect(result.engagement).not.toHaveProperty('nestedReplyCount')
    expect(result.engagement).not.toHaveProperty('totalReplyCount')
    expect(result.engagement).not.toHaveProperty('restackCount')
    expect(result.engagement).not.toHaveProperty('viewCount')
  })

  test('validates Note engagement IDs and publication scope before requesting data', async () => {
    let fetchCalled = false
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async () => {
        fetchCalled = true
        return Response.json({})
      }
    })

    expect(() => client.getNoteWithEngagement(1)).toThrow(SubstackConfigurationError)
    expect(fetchCalled).toBe(false)

    const publicationClient = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://newsletter.example.com'
    })
    await expect(publicationClient.getNoteWithEngagement('invalid')).rejects.toBeInstanceOf(
      SubstackConfigurationError
    )
  })

  test('gets reply and mention activity through the global activity endpoint', async () => {
    let request: Request | undefined
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json({ activityItems: [] })
      }
    })

    await client.getActivity('replies-and-mentions')

    expect(request?.url).toBe('https://substack.com/api/v1/activity-feed-web?filter=replies-and-mentions')
  })

  test('gets publication email stats using the dashboard defaults and supplied query options', async () => {
    const requests: Request[] = []
    const row = {
      post_id: 123,
      delivered: 500,
      opens: 162,
      clicks: 3,
      likes: 9,
      comments: 2,
      shares: 4,
      restacks: 1
    } satisfies EmailStatsRow
    const response = { rows: [row], total: 1 }
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        requests.push(request)
        return Response.json(response)
      }
    })

    const page = await client.getEmailStats()
    expect(page).toEqual(response)
    expect(page.rows?.[0]?.restacks).toBe(1)
    await client.getEmailStats({ offset: 20, limit: 50, orderBy: 'opens', orderDirection: 'asc' })

    expect(requests.map((request) => request.url)).toEqual([
      'https://allagentsconsidered.substack.com/api/v1/publication/stats/email_stats?offset=0&limit=20&order_by=post_date&order_direction=desc',
      'https://allagentsconsidered.substack.com/api/v1/publication/stats/email_stats?offset=20&limit=20&order_by=opens&order_direction=asc'
    ])
  })

  test('validates the email stats offset', () => {
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com'
    })

    expect(() => client.getEmailStats({ offset: -1 })).toThrow(SubstackConfigurationError)
  })

  test('collects every email stats page into one array', async () => {
    const requests: string[] = []
    const pages = new Map([
      [0, [{ post_id: 1 }, { post_id: 2 }]],
      [2, [{ post_id: 3 }]],
      [3, []]
    ])
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com',
      fetch: async (input) => {
        const url = new URL(new Request(input).url)
        requests.push(url.toString())
        return Response.json({ rows: pages.get(Number(url.searchParams.get('offset'))) })
      }
    })

    await expect(
      client.getAllEmailStats<{ post_id: number }>({ limit: 2, orderBy: 'opens', orderDirection: 'asc' })
    ).resolves.toEqual([{ post_id: 1 }, { post_id: 2 }, { post_id: 3 }])
    expect(requests).toEqual([
      'https://allagentsconsidered.substack.com/api/v1/publication/stats/email_stats?offset=0&limit=20&order_by=opens&order_direction=asc',
      'https://allagentsconsidered.substack.com/api/v1/publication/stats/email_stats?offset=2&limit=20&order_by=opens&order_direction=asc',
      'https://allagentsconsidered.substack.com/api/v1/publication/stats/email_stats?offset=3&limit=20&order_by=opens&order_direction=asc'
    ])
  })

  test('gets subscriber stats and breakdown from modern publication stats endpoint', async () => {
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com',
      fetch: async (input) => {
        const url = new Request(input).url
        if (url.includes('/publication/stats/subscribers')) {
          return Response.json({
            subscribers: 5,
            lifetime_subscribers: 8,
            comp_subscribers: 2,
            gift_subscribers: 1,
            free_trial_subscribers: 0,
            founding_subscribers: 1,
            totalEmail: 534
          })
        }
        if (url.includes('/publish-dashboard/summary')) {
          return Response.json({
            appSubscribers: 314,
            totalEmail: 534,
            subscribers: 5,
            openRate: 24.368,
            views: 2097,
            numPledges: 3,
            pledgesAmount: 150,
            pledgeCurrency: 'usd'
          })
        }
        return new Response('Not Found', { status: 404 })
      }
    })

    const result = await client.getSubscriberStats()
    expect(result).toMatchObject({
      total_subscribers: 534,
      paid_subscribers: 5,
      free_subscribers: 529,
      app_subscribers: 314,
      comp_subscribers: 2,
      gift_subscribers: 1,
      founding_subscribers: 1,
      lifetime_subscribers: 8,
      views: 2097,
      open_rate: '24.4%',
      num_pledges: 3,
      pledges_amount: 150,
      pledge_currency: 'usd'
    })

    const paidBreakdown = await client.getPaidSubscribers()
    expect(paidBreakdown).toEqual({
      total_subscribers: 534,
      paid_subscribers: 5,
      free_subscribers: 529,
      app_subscribers: 314,
      comp_subscribers: 2,
      gift_subscribers: 1,
      free_trial_subscribers: 0,
      founding_subscribers: 1,
      lifetime_subscribers: 8,
      pledges_amount: 150,
      num_pledges: 3,
      pledge_currency: 'usd'
    })
  })

  test('falls back to legacy subscriber-stats when modern stats return 404', async () => {
    let request: Request | undefined
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com',
      fetch: async (input, init) => {
        request = new Request(input, init)
        const url = request.url
        if (url.includes('/publication/stats/subscribers') || url.includes('/publish-dashboard/summary')) {
          return new Response('Not Found', { status: 404 })
        }
        if (url.includes('/subscriber-stats')) {
          return Response.json({ subscribers: [{ user_id: 1, user_email_address: 'reader@example.com' }] })
        }
        return new Response('Not Found', { status: 404 })
      }
    })

    await expect(client.getSubscriberStats<{ user_id: number; user_email_address: string }>()).resolves.toEqual({
      subscribers: [{ user_id: 1, user_email_address: 'reader@example.com' }]
    })
    expect(request?.headers.get('cookie')).toBe('substack.sid=session-value')
  })

  test('falls back to email-stats when modern stats and subscriber-stats return 404', async () => {
    const requests: string[] = []
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com',
      fetch: async (input) => {
        const url = new Request(input).url
        requests.push(url)
        if (url.includes('/publication/stats/subscribers') || url.includes('/publish-dashboard/summary')) {
          return new Response('Not Found', { status: 404 })
        }
        if (url.includes('/subscriber-stats')) {
          return new Response('Not Found', { status: 404 })
        }
        if (url.includes('/email-stats')) {
          return Response.json([
            {
              delivered: 1500,
              signups: 12,
              title: 'Latest Post Title',
              open_rate: 0.452
            }
          ])
        }
        return new Response('Not Found', { status: 404 })
      }
    })

    const result = await client.getSubscriberStats()
    expect(result).toEqual({
      derived_from_delivery: true,
      total_subscribers: 1500,
      active_subscribers_delivered: 1500,
      recent_signups: 12,
      latest_post_title: 'Latest Post Title',
      open_rate: '45.2%'
    })
  })

  test('re-throws non-404 errors when getting subscriber stats', async () => {
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com',
      fetch: async () => new Response('Internal Server Error', { status: 500 })
    })

    await expect(client.getSubscriberStats()).rejects.toThrow(SubstackApiError)
  })

  test('gets publication growth sources with query options', async () => {
    const requests: Request[] = []
    const fakeResponse = {
      sourceMetrics: [
        {
          source: 'substack',
          sourceName: 'Substack',
          metrics: [{ name: 'Traffic', total: 149 }]
        }
      ],
      totals: [{ name: 'traffic', total: 149 }]
    }
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        requests.push(request)
        return Response.json(fakeResponse)
      }
    })

    const result = await client.getGrowthSources({
      fromDate: '2026-07-29',
      toDate: '2026-08-27',
      orderBy: 'users',
      orderDirection: 'desc'
    })

    expect(result).toEqual({ ...fakeResponse, granularity: 'total' })
    expect(requests[0].url).toBe(
      'https://allagentsconsidered.substack.com/api/v1/publication/stats/growth/sources?order_by=users&order_direction=desc&from_date=2026-07-29&to_date=2026-08-27'
    )

    await client.getGrowthSources({
      from_date: '2026-03-01',
      to_date: '2026-03-31',
      order_by: 'subscriptions',
      order_direction: 'asc'
    })

    expect(requests[1].url).toBe(
      'https://allagentsconsidered.substack.com/api/v1/publication/stats/growth/sources?order_by=subscriptions&order_direction=asc&from_date=2026-03-01&to_date=2026-03-31'
    )

    const weeklyResult = await client.getGrowthSources({
      fromDate: '2026-08-01',
      toDate: '2026-08-15',
      granularity: 'week'
    })

    expect(weeklyResult.granularity).toBe('week')
    expect(weeklyResult.intervals?.length).toBe(3)
    expect(weeklyResult.intervals?.[0].startDate).toBe('2026-08-01')
    expect(weeklyResult.intervals?.[0].endDate).toBe('2026-08-07')
  })

  test('enforces granularity limits and rejects inverted ranges', async () => {
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com'
    })

    await expect(
      client.getGrowthSources({
        fromDate: '2026-01-01',
        toDate: '2026-03-01',
        granularity: 'day'
      })
    ).rejects.toThrow('Daily granularity is limited to a maximum range of 31 days')

    await expect(
      client.getGrowthSources({
        fromDate: '2026-08-27',
        toDate: '2026-08-01'
      })
    ).rejects.toThrow('Growth sources fromDate cannot be after toDate')
  })

  test('requires a publication URL for growth sources', () => {
    const client = new SubstackClient({ sessionToken: 'session-value' })
    expect(() => client.getGrowthSources()).toThrow(SubstackConfigurationError)
  })

  test('creates link attachments and publishes Notes through global write endpoints', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = []
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        calls.push({
          method: request.method,
          url: request.url,
          body: await request.json()
        })
        return Response.json({ id: 'attachment-or-note-id' })
      }
    })
    const attachment = { url: 'https://example.com/article', type: 'link' as const }
    const note = {
      bodyJson: { type: 'doc', attrs: { schemaVersion: 'v1' }, content: [] },
      tabId: 'for-you',
      surface: 'feed',
      replyMinimumRole: 'everyone' as const,
      attachmentIds: ['attachment-or-note-id']
    }

    await client.createAttachment(attachment)
    await client.publishNote(note)

    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://substack.com/api/v1/comment/attachment',
        body: attachment
      },
      {
        method: 'POST',
        url: 'https://substack.com/api/v1/comment/feed',
        body: note
      }
    ])
  })

  test('sets Note likes with repeatable POST and DELETE requests', async () => {
    const calls: Array<{ method: string; url: string; body: unknown; contentType: string | null }> = []
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        calls.push({
          method: request.method,
          url: request.url,
          body: await request.json(),
          contentType: request.headers.get('content-type')
        })
        return Response.json({ reaction_count: request.method === 'POST' ? 11 : 10 })
      }
    })

    await expect(client.setNoteLike<{ reaction_count: number }>(302607231, true)).resolves.toEqual({
      reaction_count: 11
    })
    await client.setNoteLike(302607231, true)
    await client.setNoteLike(302607231, false)
    await client.setNoteLike(302607231, false)

    const payload = { publication_id: null, reaction: '❤', tabId: 'for-you' }
    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://substack.com/api/v1/comment/302607231/reaction',
        body: payload,
        contentType: 'application/json'
      },
      {
        method: 'POST',
        url: 'https://substack.com/api/v1/comment/302607231/reaction',
        body: payload,
        contentType: 'application/json'
      },
      {
        method: 'DELETE',
        url: 'https://substack.com/api/v1/comment/302607231/reaction',
        body: payload,
        contentType: 'application/json'
      },
      {
        method: 'DELETE',
        url: 'https://substack.com/api/v1/comment/302607231/reaction',
        body: payload,
        contentType: 'application/json'
      }
    ])
  })

  test('maps Note action upstream errors', async () => {
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async () =>
        Response.json(
          { error: 'rate limited' },
          {
            status: 429
          }
        )
    })

    await expect(client.setNoteLike(42, true)).rejects.toMatchObject({
      name: SubstackApiError.name,
      status: 429,
      url: 'https://substack.com/api/v1/comment/42/reaction',
      detail: '{"error":"rate limited"}'
    })
  })

  test('comments on and deletes a Note comment', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = []
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        calls.push({
          method: request.method,
          url: request.url,
          body: await request.json()
        })
        return request.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : Response.json({ id: 303996871 })
      }
    })

    await expect(
      client.commentOnNote<{ id: number }>(303342892, 'Super insightful!')
    ).resolves.toEqual({ id: 303996871 })
    await expect(client.deleteComment(303996871)).resolves.toBeUndefined()

    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://substack.com/api/v1/comment/feed',
        body: {
          bodyJson: {
            type: 'doc',
            attrs: { schemaVersion: 'v1', title: null },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Super insightful!' }]
              }
            ]
          },
          parent_id: 303342892,
          tabId: 'for-you',
          surface: 'feed',
          replyMinimumRole: 'everyone'
        }
      },
      {
        method: 'DELETE',
        url: 'https://substack.com/api/v1/comment/303996871',
        body: {}
      }
    ])
  })

  test('validates Note comment bodies', () => {
    const client = new SubstackClient({ sessionToken: 'session-value' })

    expect(() => client.commentOnNote(1, '')).toThrow(SubstackConfigurationError)
    expect(() => client.commentOnNote(1, 'x'.repeat(5_001))).toThrow(SubstackConfigurationError)
  })

  test('sets Note restacks with repeatable POST and DELETE requests', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = []
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        calls.push({
          method: request.method,
          url: request.url,
          body: await request.json()
        })
        return Response.json({ restacks: request.method === 'POST' ? 1 : 0 })
      }
    })

    await client.setNoteRestack(303342892, true)
    await client.setNoteRestack(303342892, true)
    await client.setNoteRestack(303342892, false)
    await client.setNoteRestack(303342892, false)

    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://substack.com/api/v1/restack/feed',
        body: {
          postId: null,
          commentId: 303342892,
          tabId: 'for-you',
          surface: 'permalink'
        }
      },
      {
        method: 'POST',
        url: 'https://substack.com/api/v1/restack/feed',
        body: {
          postId: null,
          commentId: 303342892,
          tabId: 'for-you',
          surface: 'permalink'
        }
      },
      {
        method: 'DELETE',
        url: 'https://substack.com/api/v1/restack/feed',
        body: {
          postId: null,
          commentId: 303342892,
          tabId: 'for-you'
        }
      },
      {
        method: 'DELETE',
        url: 'https://substack.com/api/v1/restack/feed',
        body: {
          postId: null,
          commentId: 303342892,
          tabId: 'for-you'
        }
      }
    ])
  })

  test('uploads data-URL images and creates image attachments', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = []
    const uploadedImage = {
      id: 303230018,
      url: 'https://substack-post-media.s3.amazonaws.com/public/images/example.png',
      contentType: 'image/png',
      bytes: 17797,
      imageWidth: 404,
      imageHeight: 390
    }
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        calls.push({ method: request.method, url: request.url, body: await request.json() })
        return Response.json(calls.length === 1 ? uploadedImage : { id: 'image-attachment-id' })
      }
    })

    await expect(client.uploadImage('data:image/png;base64,aGVsbG8=')).resolves.toEqual(uploadedImage)
    await expect(client.createImageAttachment(uploadedImage)).resolves.toEqual({ id: 'image-attachment-id' })
    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://substack.com/api/v1/image',
        body: { image: 'data:image/png;base64,aGVsbG8=' }
      },
      {
        method: 'POST',
        url: 'https://substack.com/api/v1/comment/attachment',
        body: {
          url: uploadedImage.url,
          type: 'image'
        }
      }
    ])
  })

  test('builds person-tagged Note bodies without losing surrounding text', () => {
    const bodyJson = createNoteBodyJson('Thanks @dancn!', [
      { id: '44242110', handle: '@dancn', label: 'Dan Cucolea' }
    ])

    expect(bodyJson.content[0]?.content).toEqual([
      { type: 'text', text: 'Thanks ' },
      {
        type: 'substack_mention',
        attrs: {
          id: 44242110,
          label: 'Dan Cucolea',
          mentionType: 'user',
          url: null
        }
      },
      { type: 'text', text: '!' }
    ])
    expect(() =>
      createNoteBodyJson('No matching tag', [
        { id: 44242110, handle: 'dancn', label: 'Dan Cucolea' }
      ])
    ).toThrow(SubstackConfigurationError)
  })

  test('schedules a Note through the global draft endpoint', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = []
    const scheduledDraft = {
      id: 296235019,
      status: 'draft',
      trigger_at: '2026-07-18T08:12:00.000Z',
      reaction_count: 0,
      restacks: 0,
      children_count: 0
    }
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        calls.push({
          method: request.method,
          url: request.url,
          body: await request.json()
        })
        return Response.json(scheduledDraft)
      }
    })
    const note = {
      bodyJson: createNoteBodyJson('@dancn', [
        { id: 44242110, handle: 'dancn', label: 'Dan Cucolea' }
      ]),
      tabId: 'subscribed',
      surface: 'feed',
      replyMinimumRole: 'everyone' as const,
      triggerAt: '2026-07-18T08:12:00.000Z'
    }

    await expect(client.scheduleNote(note)).resolves.toEqual(scheduledDraft)
    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://substack.com/api/v1/comment/draft',
        body: {
          bodyJson: {
            type: 'doc',
            attrs: { schemaVersion: 'v1', title: null },
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'substack_mention',
                    attrs: {
                      id: 44242110,
                      label: 'Dan Cucolea',
                      mentionType: 'user',
                      url: null
                    }
                  }
                ]
              }
            ]
          },
          tabId: 'subscribed',
          surface: 'feed',
          replyMinimumRole: 'everyone',
          trigger_at: '2026-07-18T08:12:00.000Z'
        }
      }
    ])
  })

  test('updates a scheduled Note through the global feed comment endpoint', async () => {
    let request: Request | undefined
    const response = { id: 289737400, status: 'draft', trigger_at: '2026-07-17T14:01:00.000Z' }
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json(response)
      }
    })
    const note = {
      bodyJson: {
        type: 'doc',
        attrs: { schemaVersion: 'v1', title: null },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated scheduled note' }] }]
      },
      replyMinimumRole: 'everyone' as const,
      attachmentIds: ['attachment-or-note-id'],
      triggerAt: '2026-07-17T14:01:00.000Z'
    }

    await expect(client.updateScheduledNote(289737400, note)).resolves.toEqual(response)
    expect(request?.url).toBe('https://substack.com/api/v1/feed/comment/289737400')
    expect(request?.method).toBe('PATCH')
    expect(await request?.json()).toEqual({
      bodyJson: note.bodyJson,
      replyMinimumRole: 'everyone',
      attachmentIds: ['attachment-or-note-id'],
      trigger_at: '2026-07-17T14:01:00.000Z'
    })
  })

  test('gets scheduled Note drafts through the global drafts endpoint', async () => {
    let request: Request | undefined
    const response = {
      drafts: [
        {
          id: 296235019,
          body: 'Test',
          trigger_at: '2026-07-18T08:12:00.000Z',
          attachments: []
        }
      ],
      hasMore: false,
      nextCursor: null
    }
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json(response)
      }
    })

    await expect(
      client.getDraftNotes<{ id: number; body: string; trigger_at: string; attachments: unknown[] }>()
    ).resolves.toEqual(response)
    expect(request?.url).toBe('https://substack.com/api/v1/feed/drafts?limit=20')
    expect(request?.method).toBe('GET')
  })

  test('validates the scheduled Note drafts limit', () => {
    const client = new SubstackClient({ sessionToken: 'session-value' })

    expect(() => client.getDraftNotes({ limit: 0 })).toThrow(SubstackConfigurationError)
  })

  test('deletes a Note through the global comment endpoint', async () => {
    let request: Request | undefined
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return new Response(null, { status: 204 })
      }
    })

    await expect(client.deleteNote(296235019)).resolves.toBeUndefined()
    expect(request?.url).toBe('https://substack.com/api/v1/comment/296235019')
    expect(request?.method).toBe('DELETE')
    expect(request?.headers.get('cookie')).toBe('substack.sid=session-value')
  })

  test('resolves a profile ID through its public handle', async () => {
    const calls: string[] = []
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input) => {
        const url = new Request(input).url
        calls.push(url)

        if (url.endsWith('/reader/feed/profile/7')) {
          return Response.json({
            items: [{ context: { users: [{ id: 7, handle: 'allagentsconsidered' }] } }]
          })
        }

        return Response.json({ id: 7, handle: 'allagentsconsidered' })
      }
    })

    await expect(client.getProfileById(7)).resolves.toEqual({ id: 7, handle: 'allagentsconsidered' })
    expect(calls).toEqual([
      'https://substack.com/api/v1/reader/feed/profile/7',
      'https://substack.com/api/v1/user/allagentsconsidered/public_profile'
    ])
  })

  test('annotates unread activity using Substack’s unread count', async () => {
    const client = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async (input) => {
        const url = new Request(input).url
        if (url.endsWith('/activity/unread')) {
          return Response.json({ count: 2, max: 20, lastViewedAt: '2026-07-14T00:00:00Z' })
        }
        return Response.json({ activityItems: [{ id: 1 }, { id: 2 }, { id: 3 }] })
      }
    })

    await expect(client.getUnreadActivity()).resolves.toEqual({
      activityItems: [{ id: 1 }, { id: 2 }],
      unread: {
        count: 2,
        max: 20,
        lastViewedAt: '2026-07-14T00:00:00Z',
        strategy: 'latest-activity-items'
      }
    })
  })

  test('surfaces configuration and upstream API errors predictably', async () => {
    const noPublication = new SubstackClient({ sessionToken: 'session-value' })
    expect(() => noPublication.getProfileNotes(123)).toThrow(SubstackConfigurationError)

    const rejected = new SubstackClient({
      sessionToken: 'session-value',
      fetch: async () => Response.json({ error: 'expired session' }, { status: 401 })
    })

    await expect(rejected.getPost(42)).rejects.toMatchObject({
      name: SubstackApiError.name,
      status: 401,
      url: 'https://substack.com/api/v1/posts/by-id/42',
      detail: '{"error":"expired session"}'
    })
  })
})
