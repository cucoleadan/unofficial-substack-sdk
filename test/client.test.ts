import { describe, expect, test } from 'bun:test'

import {
  apiBase,
  createNoteBodyJson,
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

    await client.getNotes()

    expect(request?.url).toBe('https://newsletter.example.com/api/v1/notes')
    expect(request?.headers.get('cookie')).toBe('substack.sid=session-value')
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

  test('uses the publication origin for Notes and encodes cursor values', async () => {
    let request: Request | undefined
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com/?utm_campaign=profile_chips',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json({ items: [] })
      }
    })

    await client.getNotes({ cursor: 'next page' })

    expect(request?.url).toBe('https://allagentsconsidered.substack.com/api/v1/notes?cursor=next%20page')
  })

  test('annotates profile Notes with the authenticated viewer like state', async () => {
    let request: Request | undefined
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json({
          items: [
            { comment: { id: 1, reaction: '❤', reaction_count: 11 } },
            { comment: { id: 2, reaction_count: 10 } },
            { comment: { id: 3, reaction: false } },
            { comment: { id: 4, reaction: 'unexpected' } },
            { context: { type: 'note' } }
          ],
          nextCursor: null
        })
      }
    })

    await expect(client.getProfileNotes(7)).resolves.toEqual({
      items: [
        { comment: { id: 1, reaction: '❤', reaction_count: 11 }, viewerHasLiked: true },
        { comment: { id: 2, reaction_count: 10 }, viewerHasLiked: false },
        { comment: { id: 3, reaction: false }, viewerHasLiked: false },
        { comment: { id: 4, reaction: 'unexpected' }, viewerHasLiked: null },
        { context: { type: 'note' }, viewerHasLiked: null }
      ],
      nextCursor: null
    })
    expect(request?.url).toBe(
      'https://allagentsconsidered.substack.com/api/v1/reader/feed/profile/7?types=note'
    )
  })

  test('gets Note reply branches through the global reader endpoint', async () => {
    let request: Request | undefined
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
        request = new Request(input, init)
        return Response.json(response)
      }
    })

    await expect(client.getNoteReplies(300750684)).resolves.toEqual(response)
    expect(request?.method).toBe('GET')
    expect(request?.url).toBe(
      'https://substack.com/api/v1/reader/comment/300750684/replies?comment_id=300750684'
    )
    expect(request?.headers.get('cookie')).toBe('substack.sid=session-value')
    expect(() => client.getNoteReplies(0)).toThrow(SubstackConfigurationError)
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
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        requests.push(request)
        return Response.json({ rows: [] })
      }
    })

    await client.getEmailStats()
    await client.getEmailStats({ offset: 20, limit: 50, orderBy: 'opens', orderDirection: 'asc' })

    expect(requests.map((request) => request.url)).toEqual([
      'https://allagentsconsidered.substack.com/api/v1/publication/stats/email_stats?offset=0&limit=20&order_by=post_date&order_direction=desc',
      'https://allagentsconsidered.substack.com/api/v1/publication/stats/email_stats?offset=20&limit=50&order_by=opens&order_direction=asc'
    ])
  })

  test('validates email stats pagination values', () => {
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com'
    })

    expect(() => client.getEmailStats({ offset: -1 })).toThrow(SubstackConfigurationError)
    expect(() => client.getEmailStats({ limit: 0 })).toThrow(SubstackConfigurationError)
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
      'https://allagentsconsidered.substack.com/api/v1/publication/stats/email_stats?offset=0&limit=2&order_by=opens&order_direction=asc',
      'https://allagentsconsidered.substack.com/api/v1/publication/stats/email_stats?offset=2&limit=2&order_by=opens&order_direction=asc',
      'https://allagentsconsidered.substack.com/api/v1/publication/stats/email_stats?offset=3&limit=2&order_by=opens&order_direction=asc'
    ])
  })

  test('gets subscriber stats from the publication origin', async () => {
    let request: Request | undefined
    const client = new SubstackClient({
      sessionToken: 'session-value',
      publicationUrl: 'https://allagentsconsidered.substack.com',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json({ subscribers: [{ user_id: 1, user_email_address: 'reader@example.com' }] })
      }
    })

    await expect(client.getSubscriberStats<{ user_id: number; user_email_address: string }>()).resolves.toEqual({
      subscribers: [{ user_id: 1, user_email_address: 'reader@example.com' }]
    })
    expect(request?.url).toBe('https://allagentsconsidered.substack.com/api/v1/subscriber-stats')
    expect(request?.headers.get('cookie')).toBe('substack.sid=session-value')
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
    const bodyJson = createNoteBodyJson('Thanks @Mia Kiraki 🎭!', [
      { id: '362428399', label: 'Mia Kiraki 🎭' }
    ])

    expect(bodyJson.content[0]?.content).toEqual([
      { type: 'text', text: 'Thanks ' },
      {
        type: 'substack_mention',
        attrs: {
          id: 362428399,
          label: 'Mia Kiraki 🎭',
          mentionType: 'user',
          url: null
        }
      },
      { type: 'text', text: '!' }
    ])
    expect(() =>
      createNoteBodyJson('No matching tag', [{ id: 362428399, label: 'Mia Kiraki 🎭' }])
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
      bodyJson: createNoteBodyJson('@Mia Kiraki 🎭', [
        { id: 362428399, label: 'Mia Kiraki 🎭' }
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
                      id: 362428399,
                      label: 'Mia Kiraki 🎭',
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
    expect(() => noPublication.getNotes()).toThrow(SubstackConfigurationError)

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
