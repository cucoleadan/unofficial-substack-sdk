/**
 * Live verification of which Note formatting Substack keeps.
 *
 * WARNING: this publishes short-lived public Notes on the account whose
 * session is in SUBSTACK_SESSION_TOKEN, then deletes them. Use a throwaway
 * account. The only mention it creates is a self-mention, so nobody else is
 * notified.
 *
 *   bun --env-file=.dev.vars scripts/verify-note-formatting.ts \
 *     --i-understand-this-publishes --forbid-user-id <your main user ID> --report report.json
 *
 * For each case it records the document as sent, as stored in the draft, and
 * as returned after publishing, plus every difference between them.
 *
 * Add --normalized to publish only documents prepared by
 * normalizeNoteBodyJson and markdownToNoteBodyJson. Every one of them should
 * come back with no differences.
 */
import { writeFileSync } from 'node:fs'

import { markdownToNoteBodyJson, normalizeNoteBodyJson, SubstackApiError, SubstackClient } from '../src/core/index.js'

const args = process.argv.slice(2)
const argValue = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
if (!args.includes('--i-understand-this-publishes')) {
  console.error('Refusing to run: this script publishes Notes. Pass --i-understand-this-publishes.')
  process.exit(2)
}
const token = process.env.SUBSTACK_SESSION_TOKEN
if (!token) {
  console.error('SUBSTACK_SESSION_TOKEN is not set.')
  process.exit(2)
}
const forbiddenUserIds = (argValue('--forbid-user-id') ?? '').split(',').filter(Boolean).map(Number)
const reportPath = argValue('--report') ?? 'note-formatting-report.json'

const API = 'https://substack.com/api/v1'
const client = new SubstackClient({ sessionToken: token })
const marker = `sdk-format-${Date.now().toString(36)}`
const cleanup = new Set<number>()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function raw(method: string, path: string): Promise<{ status: number; json: any }> {
  const response = await fetch(`${API}${path}`, {
    method,
    redirect: 'error',
    headers: { accept: 'application/json', cookie: `substack.sid=${token}` }
  })
  const text = (await response.text()).split(token!).join('[redacted]')
  try {
    return { status: response.status, json: JSON.parse(text) }
  } catch {
    return { status: response.status, json: text.slice(0, 300) }
  }
}

function errorInfo(error: unknown) {
  return error instanceof SubstackApiError
    ? { status: error.status, upstreamMessage: error.upstreamMessage ?? null, detail: error.detail }
    : { message: String(error) }
}

/** Lists every path where two JSON values differ. */
function diff(a: unknown, b: unknown, path = '$'): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return []
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: string[] = []
    if (a.length !== b.length) out.push(`${path}.length: ${a.length} -> ${b.length}`)
    for (let i = 0; i < Math.min(a.length, b.length); i++) out.push(...diff(a[i], b[i], `${path}[${i}]`))
    return out
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out: string[] = []
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      out.push(...diff((a as any)[key], (b as any)[key], `${path}.${key}`))
    }
    return out
  }
  return [`${path}: ${JSON.stringify(a)?.slice(0, 120)} -> ${JSON.stringify(b)?.slice(0, 120)}`]
}

const doc = (...content: unknown[]) => ({ type: 'doc', attrs: { schemaVersion: 'v1', title: null }, content })
const p = (...content: unknown[]) => ({ type: 'paragraph', content })
const t = (text: string, ...marks: unknown[]) => (marks.length ? { type: 'text', text, marks } : { type: 'text', text })
const bold = { type: 'bold' }
const italic = { type: 'italic' }
const strike = { type: 'strike' }
const code = { type: 'code' }
const link = (href: string) => ({
  type: 'link',
  attrs: { href, target: '_blank', rel: 'nofollow ugc noopener', class: 'note-link' }
})
const li = (...content: unknown[]) => ({ type: 'listItem', content })

async function main() {
  const handles = await raw('GET', '/handle/options')
  const handle = handles.json?.potentialHandles?.find((entry: any) => entry.type === 'existing')?.handle
  const profile = handle ? await raw('GET', `/user/${handle}/public_profile`) : undefined
  const me = { id: Number(profile?.json?.id), name: String(profile?.json?.name ?? 'Test') }
  if (!me.id) throw new Error('Could not resolve the authenticated account.')
  if (forbiddenUserIds.includes(me.id)) {
    console.error('Refusing to run: the session belongs to a forbidden account.')
    process.exit(3)
  }
  console.log('Account check passed (not a forbidden account).')
  const selfMention = (url: string | null = null) => ({
    type: 'substack_mention',
    attrs: { id: me.id, label: me.name, mentionType: 'user', url }
  })
  const head = (label: string) => p(t(`Automated SDK formatting test (${marker} ${label}). This Note will be deleted.`))

  const cases: Array<{ label: string; bodyJson: unknown }> = [
    {
      label: 'marks',
      bodyJson: doc(
        head('marks'),
        p(t('plain '), t('bold', bold), t(' '), t('italic', italic), t(' '), t('strike', strike), t(' '), t('code', code)),
        p(t('bold italic', bold, italic), t(' and '), t('bold strike', bold, strike))
      )
    },
    {
      label: 'links',
      bodyJson: doc(
        head('links'),
        p(t('A '), t('full link', link('https://example.com/a?b=1&c=two#frag')), t(' in text.')),
        p(t('Bold link', bold, link('https://example.com/bold'))),
        p(t('Bare link mark', { type: 'link', attrs: { href: 'https://example.com/bare' } })),
        p(t('https://example.com/autolink', link('https://example.com/autolink'))),
        p(t('Unicode ünï 🚀 ', italic), t('link', link('https://example.com/ü?q=ü')))
      )
    },
    {
      label: 'mentions',
      bodyJson: doc(
        head('mentions'),
        p(t('Hello '), selfMention(), t(', and again '), selfMention(), t('!')),
        p(selfMention(), t(' at the start, then a '), t('link', link('https://example.com/m')), t(' next to '), selfMention()),
        p(t('Mention with a URL: '), selfMention(`https://substack.com/@${handle}`)),
        p(t('Bold around '), { ...selfMention(), marks: [bold] }, t(' mention.'))
      )
    },
    {
      label: 'lists',
      bodyJson: doc(
        head('lists'),
        { type: 'bulletList', content: [li(p(t('first bullet'))), li(p(t('second '), t('bold', bold)))] },
        { type: 'orderedList', attrs: { start: 1 }, content: [li(p(t('one'))), li(p(t('two')))] },
        { type: 'orderedList', attrs: { start: 3 }, content: [li(p(t('three'))), li(p(t('four')))] },
        {
          type: 'bulletList',
          content: [li(p(t('outer')), { type: 'bulletList', content: [li(p(t('nested')))] })]
        },
        { type: 'orderedList', content: [li(p(t('ordered without attrs')))] }
      )
    },
    {
      label: 'blocks',
      bodyJson: doc(
        head('blocks'),
        { type: 'blockquote', content: [p(t('quoted line one')), p(t('quoted '), t('two', italic))] },
        { type: 'codeBlock', attrs: { language: null }, content: [t('const a = 1\nconst b = 2')] },
        { type: 'codeBlock', content: [t('code block without attrs')] }
      )
    },
    {
      label: 'whitespace',
      bodyJson: doc(
        head('whitespace'),
        p(t('  leading and trailing spaces  ')),
        p(t('double  spaces and\ttab')),
        { type: 'paragraph', content: [] },
        p(t('after empty paragraph'))
      )
    },
    {
      label: 'unsupported',
      bodyJson: doc(
        head('unsupported'),
        { type: 'heading', attrs: { level: 2 }, content: [t('a heading')] },
        p(t('underlined', { type: 'underline' })),
        { type: 'horizontalRule' },
        p(t('after rule'))
      )
    }
  ]

  // --normalized: publish only SDK-prepared documents, which must come back unchanged.
  const runCases = args.includes('--normalized')
    ? [
        ...cases
          .filter((testCase) => testCase.label !== 'unsupported')
          .map((testCase) => ({ label: `${testCase.label}-normalized`, bodyJson: normalizeNoteBodyJson(testCase.bodyJson) })),
        {
          label: 'markdown',
          bodyJson: markdownToNoteBodyJson(
            [
              `Automated SDK formatting test (${marker} markdown). This Note will be deleted.`,
              `Hi @${me.name}, **bold** *italic* ~~strike~~ \`code\` ***both*** and https://example.com/a_b?c=1.`,
              `**@${me.name}** and **https://example.com/bold** then a plain \\*star\\*.`,
              '- first',
              '  - nested *item*',
              '- second',
              '3. three',
              '4. four',
              '> quoted **line**',
              '```ts',
              'const a = 1',
              '```'
            ].join('\n'),
            [{ id: me.id, label: me.name }]
          )
        }
      ]
    : cases

  const results: Array<Record<string, unknown>> = []
  for (const testCase of runCases) {
    const result: Record<string, unknown> = { label: testCase.label, sent: testCase.bodyJson }
    results.push(result)
    try {
      const draft = await client.createDraftNote({ bodyJson: testCase.bodyJson, replyMinimumRole: 'everyone' })
      cleanup.add(draft.id)
      result.createResponseBodyJson = draft.body_json
      result.createResponseBody = draft.body
      const listed = (await client.getAllDraftNotes({ maxItems: 1_000 })).find((entry) => entry.id === draft.id)
      result.draftListBodyJson = listed?.body_json

      const published = await client.publishNote({
        bodyJson: testCase.bodyJson,
        tabId: 'for-you',
        surface: 'feed',
        replyMinimumRole: 'everyone',
        draftCommentId: draft.id
      })
      cleanup.add(published.id)
      result.publishResponseBodyJson = published.body_json
      await sleep(2_000)

      const reader = await raw('GET', `/reader/comment/${published.id}`)
      result.readerBodyJson = (reader.json?.item?.comment ?? reader.json?.comment)?.body_json
      result.readerBody = (reader.json?.item?.comment ?? reader.json?.comment)?.body
      const feed = await client.getProfileFeed(me.id, { types: ['note'], limit: 20 })
      const feedItem = feed.items.find((item: any) => item?.comment?.id === published.id) as any
      result.profileFeedBodyJson = feedItem?.comment?.body_json

      result.diffSentToDraft = diff(testCase.bodyJson, result.createResponseBodyJson)
      result.diffSentToPublished = diff(testCase.bodyJson, result.readerBodyJson)
      result.diffDraftToPublished = diff(result.createResponseBodyJson, result.readerBodyJson)
      result.diffReaderToProfileFeed = diff(result.readerBodyJson, result.profileFeedBodyJson)
      console.log(`${testCase.label}: ${(result.diffSentToPublished as string[]).length} differences sent -> published`)
      for (const line of result.diffSentToPublished as string[]) console.log(`  ${line}`)

      await raw('DELETE', `/comment/${published.id}`)
    } catch (error) {
      result.error = errorInfo(error)
      console.log(`${testCase.label}: failed`, JSON.stringify(result.error))
    }
  }
  return results
}

const report: Record<string, unknown> = { marker, startedAt: new Date().toISOString() }
try {
  report.cases = await main()
} catch (error) {
  report.fatal = errorInfo(error)
  console.error('Fatal:', report.fatal)
} finally {
  const handles = await raw('GET', '/handle/options').catch(() => undefined)
  const handle = handles?.json?.potentialHandles?.find((entry: any) => entry.type === 'existing')?.handle
  const profile = handle ? await raw('GET', `/user/${handle}/public_profile`) : undefined
  const myId = Number(profile?.json?.id)
  if (myId) {
    const feed = await client.getProfileFeed(myId, { types: ['note'], limit: 50 }).catch(() => ({ items: [] }))
    for (const item of feed.items as any[]) {
      if (typeof item?.comment?.body === 'string' && item.comment.body.includes(marker)) cleanup.add(item.comment.id)
    }
  }
  for (const draft of await client.getAllDraftNotes({ maxItems: 1_000 }).catch(() => [])) {
    if (typeof draft.body === 'string' && draft.body.includes(marker)) cleanup.add(draft.id)
  }
  for (const id of cleanup) await raw('DELETE', `/comment/${id}`)
  const leftoverDrafts = (await client.getAllDraftNotes({ maxItems: 1_000 }).catch(() => [])).filter(
    (draft) => typeof draft.body === 'string' && draft.body.includes(marker)
  ).length
  const leftoverFeed = myId
    ? ((await client.getProfileFeed(myId, { types: ['note'], limit: 50 }).catch(() => ({ items: [] }))).items as any[]).filter(
        (item) => typeof item?.comment?.body === 'string' && item.comment.body.includes(marker)
      ).length
    : null
  report.cleanup = { leftoverDrafts, leftoverNotes: leftoverFeed }
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nCleanup: leftover drafts=${leftoverDrafts}, leftover Notes=${leftoverFeed}. Report: ${reportPath}`)
}
