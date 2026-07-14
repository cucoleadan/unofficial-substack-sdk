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
