import { describe, expect, test } from 'bun:test'

import {
  createNoteBodyJson,
  type DraftNote,
  type NoteAttachment,
  noteBodyJsonToText,
  type ScheduledNoteResponse,
  SubstackApiError,
  SubstackClient,
  SubstackConfigurationError
} from '../src/core/index.js'
import attachmentImage from './fixtures/note-drafts/attachment-image.json'
import attachmentLink from './fixtures/note-drafts/attachment-link.json'
import draftsPage from './fixtures/note-drafts/drafts-page.json'
import upstreamErrors from './fixtures/note-drafts/errors.json'
import blankParagraphRequest from './fixtures/note-drafts/schedule-request-blank-paragraphs.json'
import scheduleResponse from './fixtures/note-drafts/schedule-response.json'
import uploadResponse from './fixtures/note-drafts/upload-image.json'

type Call = { method: string; url: string; body?: unknown }

function recordingClient(respond: (call: Call, index: number) => Response) {
  const calls: Call[] = []
  const client = new SubstackClient({
    sessionToken: 'session-value',
    fetch: async (input, init) => {
      const request = new Request(input, init)
      const text = await request.text()
      const call: Call = { method: request.method, url: request.url, ...(text ? { body: JSON.parse(text) } : {}) }
      calls.push(call)
      return respond(call, calls.length - 1)
    }
  })
  return { client, calls }
}

function draftsResponse(ids: number[], nextCursor: string | null, hasMore = nextCursor !== null) {
  return Response.json({ drafts: ids.map((id) => ({ id, trigger_at: null })), hasMore, nextCursor })
}

describe('getDraftNotes', () => {
  test('returns typed drafts from an observed drafts page', async () => {
    const { client, calls } = recordingClient(() => Response.json(draftsPage))

    const page = await client.getDraftNotes()
    const drafts: DraftNote[] = page.drafts ?? []

    expect(calls[0]?.url).toBe('https://substack.com/api/v1/feed/drafts?limit=20')
    expect(drafts.map((draft) => draft.id)).toEqual(draftsPage.drafts.map((draft) => draft.id))
    expect(drafts.some((draft) => draft.trigger_at === null)).toBe(true)
    expect(drafts.map((draft) => draft.reply_minimum_role)).toContain('paid_subscriber')
    expect(drafts.map((draft) => draft.reply_minimum_role)).toContain(null)
    const imageAndLink = drafts.find((draft) => draft.attachments?.length === 2)
    expect(imageAndLink?.attachments?.map((attachment) => attachment.type)).toEqual(['image', 'link'])
    expect(drafts[0]?.body_json?.type).toBe('doc')
    // Raw fields without a declared type survive unchanged.
    expect(drafts[0]?.ancestor_path).toBe('')
  })

  test('sends the cursor parameter that Substack paginates with', async () => {
    const { client, calls } = recordingClient(() => draftsResponse([], null))

    await client.getDraftNotes({ limit: 100, cursor: 'opaque/cursor+value' })

    expect(calls[0]?.url).toBe(
      'https://substack.com/api/v1/feed/drafts?limit=100&cursor=opaque%2Fcursor%2Bvalue'
    )
  })

  test('validates the limit against Substack’s maximum of 100', () => {
    const client = new SubstackClient({ sessionToken: 'session-value' })

    expect(() => client.getDraftNotes({ limit: 0 })).toThrow(SubstackConfigurationError)
    expect(() => client.getDraftNotes({ limit: 101 })).toThrow(SubstackConfigurationError)
    expect(() => client.getDraftNotes({ limit: 1.5 })).toThrow(SubstackConfigurationError)
  })
})

describe('getAllDraftNotes', () => {
  test('follows cursors until Substack returns no next cursor', async () => {
    const { client, calls } = recordingClient((_call, index) =>
      index === 0 ? draftsResponse([1, 2], 'cursor-a') : draftsResponse([3], null)
    )

    const drafts = await client.getAllDraftNotes({ pageSize: 2 })

    expect(drafts.map((draft) => draft.id)).toEqual([1, 2, 3])
    expect(calls.map((call) => call.url)).toEqual([
      'https://substack.com/api/v1/feed/drafts?limit=2',
      'https://substack.com/api/v1/feed/drafts?limit=2&cursor=cursor-a'
    ])
  })

  test('stops at maxItems and shrinks the final page request', async () => {
    const { client, calls } = recordingClient((_call, index) =>
      index === 0 ? draftsResponse([1, 2, 3], 'cursor-a') : draftsResponse([4, 5], 'cursor-b')
    )

    const drafts = await client.getAllDraftNotes({ maxItems: 5, pageSize: 3 })

    expect(drafts.map((draft) => draft.id)).toEqual([1, 2, 3, 4, 5])
    expect(calls.map((call) => call.url)).toEqual([
      'https://substack.com/api/v1/feed/drafts?limit=3',
      'https://substack.com/api/v1/feed/drafts?limit=2&cursor=cursor-a'
    ])
  })

  test('skips drafts repeated across pages', async () => {
    const { client } = recordingClient((_call, index) =>
      index === 0 ? draftsResponse([1, 2], 'cursor-a') : draftsResponse([2, 3], null)
    )

    await expect(client.getAllDraftNotes()).resolves.toEqual([
      { id: 1, trigger_at: null },
      { id: 2, trigger_at: null },
      { id: 3, trigger_at: null }
    ])
  })

  test('throws instead of looping on a repeated cursor', async () => {
    const { client } = recordingClient((_call, index) => draftsResponse([index + 1], 'same-cursor'))

    await expect(client.getAllDraftNotes()).rejects.toThrow('Substack repeated a drafts cursor.')
  })

  test('throws when hasMore is true without a cursor or the drafts array is missing', async () => {
    const missingCursor = recordingClient(() => draftsResponse([1], null, true)).client
    const missingDrafts = recordingClient(() => Response.json({ hasMore: false })).client

    await expect(missingCursor.getAllDraftNotes()).rejects.toThrow(SubstackApiError)
    await expect(missingDrafts.getAllDraftNotes()).rejects.toThrow(SubstackApiError)
  })

  test('validates maxItems and pageSize', async () => {
    const client = new SubstackClient({ sessionToken: 'session-value' })

    await expect(client.getAllDraftNotes({ maxItems: 0 })).rejects.toThrow(SubstackConfigurationError)
    await expect(client.getAllDraftNotes({ maxItems: 10_001 })).rejects.toThrow(SubstackConfigurationError)
    await expect(client.getAllDraftNotes({ pageSize: 101 })).rejects.toThrow(SubstackConfigurationError)
  })
})

describe('Note mutation results', () => {
  test('scheduleNote returns the typed draft and sends replyMinimumRole and trigger_at', async () => {
    const { client, calls } = recordingClient(() => Response.json(scheduleResponse))

    const draft = await client.scheduleNote({
      bodyJson: createNoteBodyJson('Paid-only replies'),
      tabId: 'for-you',
      surface: 'feed',
      replyMinimumRole: 'paid_subscriber',
      attachmentIds: [attachmentImage.id],
      triggerAt: '2026-10-11T13:36:03.735Z'
    })
    const draftId: number = draft.id

    expect(draftId).toBe(scheduleResponse.id)
    expect(draft.status).toBe('draft')
    expect(draft.attachments?.[0]?.id).toBe(attachmentImage.id)
    expect(calls[0]).toEqual({
      method: 'POST',
      url: 'https://substack.com/api/v1/comment/draft',
      body: {
        bodyJson: createNoteBodyJson('Paid-only replies'),
        tabId: 'for-you',
        surface: 'feed',
        replyMinimumRole: 'paid_subscriber',
        attachmentIds: [attachmentImage.id],
        trigger_at: '2026-10-11T13:36:03.735Z'
      }
    })
  })

  test('createDraftNote creates an unscheduled draft without tab or surface', async () => {
    const { client, calls } = recordingClient(() => Response.json({ ...scheduleResponse, trigger_at: undefined }))

    const draft = await client.createDraftNote({
      bodyJson: createNoteBodyJson('Unscheduled'),
      replyMinimumRole: 'everyone'
    })

    expect(draft.id).toBe(scheduleResponse.id)
    expect(calls[0]).toEqual({
      method: 'POST',
      url: 'https://substack.com/api/v1/comment/draft',
      body: { bodyJson: createNoteBodyJson('Unscheduled'), replyMinimumRole: 'everyone', trigger_at: null }
    })
  })

  test('unscheduleNote resends the draft content with trigger_at null', async () => {
    const { client, calls } = recordingClient(() => Response.json(scheduleResponse))

    const updated: ScheduledNoteResponse = await client.unscheduleNote(scheduleResponse.id, {
      bodyJson: scheduleResponse.body_json,
      replyMinimumRole: 'everyone',
      attachmentIds: [attachmentImage.id]
    })

    expect(updated.id).toBe(scheduleResponse.id)
    expect(calls[0]).toEqual({
      method: 'PATCH',
      url: `https://substack.com/api/v1/feed/comment/${scheduleResponse.id}`,
      body: {
        bodyJson: scheduleResponse.body_json,
        replyMinimumRole: 'everyone',
        attachmentIds: [attachmentImage.id],
        trigger_at: null
      }
    })
  })

  test('attachment methods return typed attachment IDs', async () => {
    const { client } = recordingClient((call) =>
      Response.json((call.body as { type: string }).type === 'link' ? attachmentLink : attachmentImage)
    )

    const link: NoteAttachment = await client.createAttachment({ url: 'https://example.com/', type: 'link' })
    const image = await client.createImageAttachment(uploadResponse)

    expect(link.id).toBe(attachmentLink.id)
    expect(link.linkMetadata?.host).toBe('example.com')
    expect(image.id).toBe(attachmentImage.id)
    expect(image.imageUrl).toBe(attachmentImage.imageUrl)
  })

  test('publishNote returns the published comment ID and keeps the generic overridable', async () => {
    const { client } = recordingClient(() => Response.json({ id: 900000999, user_id: 1001, body: 'Hello' }))
    const request = {
      bodyJson: createNoteBodyJson('Hello'),
      tabId: 'for-you',
      surface: 'feed',
      replyMinimumRole: 'free_subscriber' as const
    }

    const published = await client.publishNote(request)
    const custom = await client.publishNote<{ id: number; body: string }>(request)

    expect(published.id).toBe(900000999)
    expect(custom.body).toBe('Hello')
  })
})

describe('uploadImage', () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const pngDataUrl = 'data:image/png;base64,iVBORw0KGgo='

  test('sends a data URL unchanged', async () => {
    const { client, calls } = recordingClient(() => Response.json(uploadResponse))

    await expect(client.uploadImage(pngDataUrl)).resolves.toEqual(uploadResponse)
    expect(calls[0]?.body).toEqual({ image: pngDataUrl })
  })

  test('encodes a Uint8Array, an ArrayBuffer, and a Blob as data URLs', async () => {
    const { client, calls } = recordingClient(() => Response.json(uploadResponse))

    await client.uploadImage(pngBytes, { contentType: 'image/png' })
    await client.uploadImage(pngBytes.slice().buffer, { contentType: 'IMAGE/PNG' })
    await client.uploadImage(new Blob([pngBytes], { type: 'image/png' }))

    expect(calls.map((call) => call.body)).toEqual([
      { image: pngDataUrl },
      { image: pngDataUrl },
      { image: pngDataUrl }
    ])
  })

  test('encodes large binary images without exceeding the call stack', async () => {
    const { client, calls } = recordingClient(() => Response.json(uploadResponse))
    const bytes = new Uint8Array(300_000).map((_value, index) => index % 251)

    await client.uploadImage(bytes, { contentType: 'image/jpeg' })

    const image = (calls[0]?.body as { image: string }).image
    expect(image.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(Buffer.from(image.split(',')[1]!, 'base64').equals(Buffer.from(bytes))).toBe(true)
  })

  test('requires an image content type and non-empty data before uploading', async () => {
    const { client, calls } = recordingClient(() => Response.json(uploadResponse))

    await expect(client.uploadImage(pngBytes)).rejects.toThrow(SubstackConfigurationError)
    await expect(client.uploadImage(pngBytes, { contentType: 'text/plain' })).rejects.toThrow(
      SubstackConfigurationError
    )
    await expect(client.uploadImage(new Blob([pngBytes]))).rejects.toThrow(SubstackConfigurationError)
    await expect(client.uploadImage(new Uint8Array(), { contentType: 'image/png' })).rejects.toThrow(
      SubstackConfigurationError
    )
    expect(calls).toEqual([])
  })
})

describe('SubstackApiError from Note endpoints', () => {
  const cases = upstreamErrors as Record<string, { status: number; json: unknown }>

  function failingClient(status: number, body: unknown) {
    return new SubstackClient({
      sessionToken: 'secret-session-value',
      fetch: async () =>
        typeof body === 'string'
          ? new Response(body, { status })
          : Response.json(body, { status })
    })
  }

  test.each([
    ['POST /comment/draft trigger_at more than 92 days ahead', 'trigger_at cannot be more than 92 days in the future'],
    ['POST /comment/draft 20,000-character body', 'Please type a shorter comment'],
    ['POST /comment/draft without bodyJson', 'Please add a comment or an attachment.'],
    ['POST /comment/draft with trigger_at in the past', 'trigger_at must be in the future'],
    ['PATCH /feed/comment/{id} without bodyJson', 'Please add a comment or an attachment.'],
    ['POST /image larger than the upload limit', 'Your upload is too large.'],
    ['POST /comment/draft trigger_at not a date', 'trigger_at: Invalid value'],
    ['POST /comment/attachment with an invalid URL', 'url: Invalid URL']
  ])('%s exposes Substack’s message', async (name, message) => {
    const { status, json } = cases[name]!
    const client = failingClient(status, json)

    const error = await client
      .createDraftNote({ bodyJson: {}, replyMinimumRole: 'everyone' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SubstackApiError)
    expect(error).toMatchObject({ status, upstreamMessage: message })
  })

  test('validation errors drop echoed request values from detail and issues', async () => {
    const echoed = { errors: [{ location: 'body', param: 'image', value: 'data:image/png;base64,AAAA', msg: 'Invalid value' }] }
    const client = failingClient(400, echoed)

    const error = (await client.uploadImage('data:image/png;base64,AAAA').catch((caught) => caught)) as SubstackApiError

    expect(error.upstreamMessage).toBe('image: Invalid value')
    expect(error.issues).toEqual([{ location: 'body', param: 'image', msg: 'Invalid value' }])
    expect(error.detail).toBe('{"errors":[{"location":"body","param":"image","msg":"Invalid value"}]}')
    expect(error.detail).not.toContain('base64')
  })

  test('empty upstream messages and empty bodies leave upstreamMessage undefined', async () => {
    const attachmentLimit = cases['POST /comment/draft with seven image attachments']!
    const emptyMessage = (await failingClient(attachmentLimit.status, attachmentLimit.json)
      .publishNote({ bodyJson: {}, tabId: 'for-you', surface: 'feed', replyMinimumRole: 'everyone' })
      .catch((caught) => caught)) as SubstackApiError
    const emptyBody = (await failingClient(403, '').deleteNote(1).catch((caught) => caught)) as SubstackApiError

    expect(emptyMessage).toMatchObject({ status: 400, detail: '{"error":""}' })
    expect(emptyMessage.upstreamMessage).toBeUndefined()
    expect(emptyBody).toMatchObject({ status: 403, detail: '' })
    expect(emptyBody.upstreamMessage).toBeUndefined()
  })

  test('never includes the session token', async () => {
    const client = failingClient(500, 'upstream echoed substack.sid=secret-session-value')

    const error = (await client.getDraftNotes().catch((caught) => caught)) as SubstackApiError

    expect(error.detail).toBe('upstream echoed substack.sid=[redacted]')
    expect(JSON.stringify(error)).not.toContain('secret-session-value')
  })
})

describe('createNoteBodyJson blank lines', () => {
  test('omits blank lines, which Substack discards as empty paragraphs', () => {
    const stored = scheduleResponse.body_json.content
    const sent = blankParagraphRequest.bodyJson.content

    // The observed request had four paragraphs; Substack stored two.
    expect(sent).toHaveLength(4)
    expect(stored).toHaveLength(2)
    expect(createNoteBodyJson('first\n\n\nsecond\r\n\r\nthird').content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'third' }] }
    ])
  })

  test('rejects a body made only of blank lines', () => {
    expect(() => createNoteBodyJson('\n\n')).toThrow(SubstackConfigurationError)
  })
})

describe('noteBodyJsonToText', () => {
  const author = { id: 1001, label: 'Example Author', url: null }

  test('converts an observed draft with a mention back to text and person tags', () => {
    expect(noteBodyJsonToText(scheduleResponse.body_json)).toEqual({
      text: 'sdk probe A, hello @Example Author end\nafter blanks ünïcødé 🚀',
      personTags: [author]
    })
  })

  test('round-trips every convertible draft in the observed page', () => {
    for (const draft of draftsPage.drafts) {
      const converted = noteBodyJsonToText(draft.body_json)
      expect(converted).not.toBeNull()
      expect(createNoteBodyJson(converted!.text, converted!.personTags).content).toEqual(
        draft.body_json.content as never
      )
    }
  })

  test.each([
    ['plain text', 'Hello, Substack.', []],
    ['multiple lines', 'one\ntwo\nthree', []],
    ['unicode and emoji', 'Ünïcødé ✓ — 日本語 — 👩🏽‍💻🚀', []],
    ['a mention', 'Thanks @exampleauthor!', [{ id: 44, handle: 'exampleauthor', label: 'Example Author' }]],
    ['repeated and adjacent mentions', '@a and @b@a', [
      { id: 1, handle: 'a', label: 'Ann' },
      { id: 2, handle: 'b', label: 'Bo', url: 'https://substack.com/@b' }
    ]],
    ['the 5,000-character limit', 'x'.repeat(4_000) + '\n' + 'y'.repeat(999), []]
  ])('document → text → document is lossless: %s', (_name, body, tags) => {
    const document = createNoteBodyJson(body, tags)
    const converted = noteBodyJsonToText(document)

    expect(converted).not.toBeNull()
    expect(createNoteBodyJson(converted!.text, converted!.personTags)).toEqual(document)
  })

  test('text → document → text keeps the text except blank lines', () => {
    const body = '@Ann said hi\n\n\nünïcødé 🚀\r\nlast line'
    const converted = noteBodyJsonToText(createNoteBodyJson(body, [{ id: 1, label: 'Ann' }]))

    expect(converted).toEqual({
      text: '@Ann said hi\nünïcødé 🚀\nlast line',
      personTags: [{ id: 1, label: 'Ann', url: null }]
    })
  })

  test('reports text over the 5,000-character limit so callers can reject it', () => {
    const document = createNoteBodyJson('z'.repeat(5_000))
    const tooLong = {
      ...document,
      content: [...document.content, { type: 'paragraph', content: [{ type: 'text', text: 'more' }] }]
    }

    const converted = noteBodyJsonToText(tooLong)

    expect(converted?.text).toHaveLength(5_005)
    expect(() => createNoteBodyJson(converted!.text)).toThrow(SubstackConfigurationError)
  })

  test('normalizes split text nodes, empty text nodes, and empty paragraphs', () => {
    expect(
      noteBodyJsonToText({
        type: 'doc',
        attrs: { schemaVersion: 'v1' },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo', marks: [] }] },
          { type: 'paragraph' },
          { type: 'paragraph', content: [{ type: 'text', text: '' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'world' }] }
        ]
      })
    ).toEqual({ text: 'Hello\nworld', personTags: [] })
    expect(noteBodyJsonToText({ type: 'doc', content: [] })).toEqual({ text: '', personTags: [] })
  })

  test.each([
    ['a bold mark', { type: 'paragraph', content: [{ type: 'text', text: 'hi', marks: [{ type: 'bold' }] }] }],
    ['a link mark', { type: 'paragraph', content: [{ type: 'text', text: 'hi', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] }],
    ['a hard break', { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }],
    ['a bullet list', { type: 'bulletList', content: [] }],
    ['a paragraph attribute', { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'hi' }] }],
    ['a newline inside text', { type: 'paragraph', content: [{ type: 'text', text: 'a\nb' }] }],
    ['a non-user mention', { type: 'paragraph', content: [{ type: 'substack_mention', attrs: { id: 1, label: 'Pub', mentionType: 'publication', url: null } }] }],
    ['literal mention text', { type: 'paragraph', content: [{ type: 'substack_mention', attrs: { id: 1, label: 'Ann', mentionType: 'user', url: null } }, { type: 'text', text: ' and @Ann' }] }]
  ])('returns null for %s', (_name, paragraph) => {
    expect(noteBodyJsonToText({ type: 'doc', content: [paragraph] })).toBeNull()
  })

  test('returns null when mentions cannot be told apart', () => {
    const mention = (id: number, label: string) => ({
      type: 'substack_mention',
      attrs: { id, label, mentionType: 'user', url: null }
    })

    expect(noteBodyJsonToText({ type: 'doc', content: [{ type: 'paragraph', content: [mention(1, 'Ann'), mention(2, 'Ann')] }] })).toBeNull()
    expect(noteBodyJsonToText({ type: 'doc', content: [{ type: 'paragraph', content: [mention(1, 'Ann'), mention(1, 'Annie')] }] })).toBeNull()
    expect(noteBodyJsonToText(null)).toBeNull()
    expect(noteBodyJsonToText({ type: 'paragraph' })).toBeNull()
  })
})
