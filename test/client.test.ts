import { describe, expect, test } from 'bun:test'

import {
  apiBase,
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
        url: 'https://substack.com/api/v1/comment/attachment/',
        body: attachment
      },
      {
        method: 'POST',
        url: 'https://substack.com/api/v1/comment/feed/',
        body: note
      }
    ])
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
