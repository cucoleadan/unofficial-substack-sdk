import { describe, expect, test } from 'bun:test'
import { type ActivityPage, SubstackApiError, SubstackClient, SubstackConfigurationError } from '../src/index.js'

const recent = '2026-09-06T12:00:00.000Z'
const oldest = '2026-09-05T21:53:10.058Z'
const next = '2026-09-05T21:53:10.057Z'
const item = (updated_at = oldest) => ({ updated_at, created_at: '2026-04-01T00:00:00.000Z' })

function fixture(response: unknown) {
  const requests: Request[] = []
  const client = new SubstackClient({
    sessionToken: 'test-token',
    fetch: async (input, init) => {
      requests.push(new Request(input, init))
      return response === undefined ? new Response('') : Response.json(response)
    }
  })
  return { client, requests }
}

describe('historical activity pages', () => {
  test('first page preserves every item and lookup table and uses the verified updated_at cursor', async () => {
    const response = {
      activityItems: [item(recent), { ...item(), created_at: '2026-09-05T21:53:10.062Z' }],
      more: true,
      profiles: { '1': { name: 'Example' } },
      posts: { '2': { title: 'Example' } },
      unknownFutureField: { preserved: true }
    }
    const { client, requests } = fixture(response)
    const page: ActivityPage = await client.getActivityPage()
    expect(page).toEqual({ ...response, nextAfter: next })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe('https://substack.com/api/v1/activity-feed-web?filter=all')
    expect(requests[0]!.method).toBe('GET')
  })

  test('encodes the native cursor and requested filter in a single request', async () => {
    const { client, requests } = fixture({ activityItems: [item('2026-09-04T00:00:00.000Z')], more: true })
    await client.getActivityPage({ filter: 'restacks', after: next })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe('https://substack.com/api/v1/activity-feed-web?filter=restacks&after=2026-09-05T21%3A53%3A10.057Z')
  })

  test('preserves grouped records regardless of creation date and allows updated_at ties', async () => {
    const response = { activityItems: [item(recent), item(recent), item()], more: true }
    const { client } = fixture(response)
    expect(await client.getActivityPage()).toEqual({ ...response, nextAfter: next })
  })

  for (const activityItems of [[], [item()]]) {
    test(`exhaustion with ${activityItems.length} items returns null`, async () => {
      const { client, requests } = fixture({ activityItems, more: false })
      expect(await client.getActivityPage({ after: recent })).toEqual({ activityItems, more: false, nextAfter: null })
      expect(requests).toHaveLength(1)
    })
  }

  const malformed = [
    undefined, null, [], 'invalid', {},
    { more: false }, { activityItems: [], more: 'false' },
    { activityItems: [], more: 0 }, { activityItems: [] },
    { activityItems: {}, more: false }, { activityItems: [], more: true },
    { activityItems: [null], more: false }, { activityItems: [[]], more: true },
    { activityItems: [{ created_at: oldest }], more: true },
    { activityItems: [item('bad')], more: false },
    { activityItems: [item('2026-02-30T00:00:00.000Z')], more: true },
    { activityItems: [item('0000-01-01T00:00:00.000Z')], more: true },
    { activityItems: [item(), item(recent)], more: false }
  ]
  for (const [index, response] of malformed.entries()) {
    test(`rejects malformed response ${index} rather than reporting exhaustion`, async () => {
      const { client, requests } = fixture(response)
      await expect(client.getActivityPage()).rejects.toBeInstanceOf(SubstackApiError)
      expect(requests).toHaveLength(1)
    })
  }

  for (const more of [true, false]) {
    for (const times of [[recent], [oldest], [recent, '2026-09-04T00:00:00.000Z']]) {
      test(`rejects non-advancing or out-of-bound pages: ${times.join(',')}, more=${more}`, async () => {
        const { client } = fixture({ activityItems: times.map(time => item(time)), more })
        await expect(client.getActivityPage({ after: oldest })).rejects.toBeInstanceOf(SubstackApiError)
      })
    }
  }

  for (const after of ['', 'bad', '2026-02-30T00:00:00Z', '2026-09-05', '2026-09-05T21:53:10',
    '2026-09-05T24:00:00Z', '2026-09-05T21:53:10.0581Z', '2026-09-05T21:53:10+24:00', null, 123]) {
    test(`rejects invalid input cursor ${after} before requesting activity`, async () => {
      const { client, requests } = fixture({ activityItems: [], more: false })
      await expect(client.getActivityPage({ after: after as string })).rejects.toBeInstanceOf(SubstackConfigurationError)
      expect(requests).toHaveLength(0)
    })
  }

  test('validates timezone offsets and compares their instants', async () => {
    const { client, requests } = fixture({ activityItems: [item('2026-09-05T23:53:10.058+02:00')], more: true })
    expect((await client.getActivityPage({ after: '2026-09-06T00:00:00+02:00' })).nextAfter).toBe(next)
    expect(requests[0]!.url).toContain('after=2026-09-06T00%3A00%3A00%2B02%3A00')
  })

  test('rejects invalid filters without a request', async () => {
    const { client, requests } = fixture({ activityItems: [], more: false })
    // @ts-expect-error Verify runtime validation for JavaScript callers.
    await expect(client.getActivityPage({ filter: 'invalid' })).rejects.toBeInstanceOf(SubstackConfigurationError)
    expect(requests).toHaveLength(0)
  })

  test('legacy getActivity remains raw and permissive with default and explicit filters', async () => {
    const response = { activityItems: [{ id: 1 }], more: 'unvalidated', profiles: {} }
    const { client, requests } = fixture(response)
    expect(await client.getActivity()).toEqual(response)
    expect(await client.getActivity('replies-and-mentions')).toEqual(response)
    expect(requests.map(request => request.url)).toEqual([
      'https://substack.com/api/v1/activity-feed-web?filter=all',
      'https://substack.com/api/v1/activity-feed-web?filter=replies-and-mentions'
    ])
  })
})
