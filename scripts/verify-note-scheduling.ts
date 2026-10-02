/**
 * Live verification of Substack Note scheduling behavior.
 *
 * WARNING: this publishes short-lived public Notes on the account whose
 * session is in SUBSTACK_SESSION_TOKEN, then deletes them. Use a throwaway
 * account, never a real audience.
 *
 *   bun --env-file=.dev.vars scripts/verify-note-scheduling.ts \
 *     --i-understand-this-publishes --forbid-user-id <your main user ID> --report report.json
 *
 * The report contains IDs and timings from the test account only. The session
 * token is never printed or written.
 */
import { writeFileSync } from 'node:fs'

import { createNoteBodyJson, SubstackApiError, SubstackClient } from '../src/core/index.js'

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
const reportPath = argValue('--report') ?? 'note-scheduling-report.json'

const API = 'https://substack.com/api/v1'
const client = new SubstackClient({ sessionToken: token })
const t0 = Date.now()
const marker = `sdk-verify-${t0.toString(36)}`
const report: Record<string, unknown> = { marker, startedAt: new Date(t0).toISOString() }
const events: Array<Record<string, unknown>> = []
const cleanup = new Set<number>()

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const rel = () => Number(((Date.now() - t0) / 1000).toFixed(1))
const iso = (ms: number) => new Date(ms).toISOString()
function event(label: string, name: string, data: Record<string, unknown> = {}) {
  events.push({ t: rel(), label, name, ...data })
  console.log(`[${rel()}s] ${label}: ${name}`, JSON.stringify(data).slice(0, 300))
}

type Raw = { status: number; json: any; serverDate: string | null }
async function raw(method: string, path: string, body?: unknown): Promise<Raw> {
  const response = await fetch(`${API}${path}`, {
    method,
    redirect: 'error',
    headers: {
      accept: 'application/json',
      cookie: `substack.sid=${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = (await response.text()).split(token!).join('[redacted]')
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    json = text.slice(0, 300)
  }
  return { status: response.status, json, serverDate: response.headers.get('date') }
}

function errorInfo(error: unknown) {
  return error instanceof SubstackApiError
    ? { status: error.status, upstreamMessage: error.upstreamMessage ?? null, detail: error.detail }
    : { message: String(error) }
}

async function attempt<T>(label: string, name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (error) {
    event(label, `${name} failed`, errorInfo(error))
    return undefined
  }
}

const text = (label: string) => `Automated SDK test (${marker} ${label}). This Note will be deleted.`
const body = (label: string) => createNoteBodyJson(text(label))

async function findDraft(id: number) {
  return (await client.getAllDraftNotes({ maxItems: 1_000 })).find((draft) => draft.id === id)
}

/** Reads a comment by ID from the global reader endpoint. */
async function readComment(id: number) {
  const result = await raw('GET', `/reader/comment/${id}`)
  const comment = result.json?.item?.comment ?? result.json?.comment
  return {
    status: result.status,
    commentStatus: comment?.status ?? null,
    date: comment?.date ?? null,
    deleted: comment?.deleted ?? null,
    exists: result.status === 200 && Boolean(comment) && comment.deleted !== true
  }
}

/** How the reader endpoint answers for a known unpublished draft; set in phase A. */
let draftBaseline: Awaited<ReturnType<typeof readComment>> | undefined

/** True only when a reader response can be told apart from an unpublished draft. */
function looksPublished(read: Awaited<ReturnType<typeof readComment>>): boolean {
  if (!read.exists || !draftBaseline) return false
  if (!draftBaseline.exists) return true
  if (draftBaseline.commentStatus === 'draft') return read.commentStatus !== 'draft'
  return false
}

let myUserId = 0
async function authoredMarkerNotes(): Promise<Array<{ id: number; body: string; date: string; body_json: unknown }>> {
  const result = await raw('GET', `/reader/feed/profile/${myUserId}?types[]=note&limit=50`)
  const items: any[] = Array.isArray(result.json?.items) ? result.json.items : []
  return items
    .map((item) => item?.comment)
    .filter((comment) => typeof comment?.body === 'string' && comment.body.includes(marker))
    .map((comment) => ({ id: comment.id, body: comment.body, date: comment.date, body_json: comment.body_json }))
}

async function main() {
  // Account check: never run against a forbidden (real) account.
  const handles = await raw('GET', '/handle/options')
  const handle = handles.json?.potentialHandles?.find((entry: any) => entry.type === 'existing')?.handle
  const profile = handle ? await raw('GET', `/user/${handle}/public_profile`) : undefined
  myUserId = Number(profile?.json?.id)
  if (!myUserId) throw new Error('Could not resolve the authenticated account.')
  if (forbiddenUserIds.includes(myUserId)) {
    console.error('Refusing to run: the session belongs to a forbidden account.')
    process.exit(3)
  }
  event('setup', 'account check passed (not a forbidden account)')
  const existingDrafts = await client.getAllDraftNotes({ maxItems: 1_000 })
  report.preexistingDraftCount = existingDrafts.length

  // ---------- Phase A: draft-only behavior (nothing publishes) ----------
  const pngBytes = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
    (char) => char.charCodeAt(0)
  )
  const image = await client.uploadImage(pngBytes, { contentType: 'image/png' })
  const imageAttachment = await client.createImageAttachment(image)
  const linkAttachment = await client.createAttachment({ url: 'https://example.com/', type: 'link' })
  const inDays = (days: number) => iso(Date.now() + days * 86_400_000)

  const draftA = await client.scheduleNote({
    bodyJson: body('A'),
    tabId: 'for-you',
    surface: 'feed',
    replyMinimumRole: 'everyone',
    attachmentIds: [imageAttachment.id, linkAttachment.id],
    triggerAt: inDays(7)
  })
  cleanup.add(draftA.id)
  const phaseA: Record<string, unknown> = { createdAttachmentCount: draftA.attachments?.length }
  draftBaseline = await readComment(draftA.id)
  phaseA.readerEndpointOnDraft = draftBaseline

  // A8: update without attachmentIds.
  await attempt('A8', 'update without attachmentIds', () =>
    client.updateScheduledNote(draftA.id, { bodyJson: body('A edited'), replyMinimumRole: 'everyone', triggerAt: inDays(7) })
  )
  let current = await findDraft(draftA.id)
  phaseA.attachmentsAfterUpdateWithoutIds = current?.attachments?.length ?? null
  const attachmentIds = current?.attachments?.map((attachment) => attachment.id) ?? []

  // A2: unschedule with trigger_at null, then reschedule.
  const unscheduled = await attempt('A2', 'unscheduleNote', () =>
    client.unscheduleNote(draftA.id, { bodyJson: body('A edited'), replyMinimumRole: 'everyone', attachmentIds })
  )
  current = await findDraft(draftA.id)
  phaseA.unscheduleAccepted = unscheduled !== undefined
  phaseA.triggerAtAfterUnschedule = current ? (current.trigger_at ?? null) : 'draft missing'
  const reschedule = await attempt('A2', 'reschedule', () =>
    client.updateScheduledNote(draftA.id, { bodyJson: body('A edited'), replyMinimumRole: 'everyone', attachmentIds, triggerAt: inDays(8) })
  )
  current = await findDraft(draftA.id)
  phaseA.rescheduleAccepted = reschedule !== undefined
  phaseA.triggerAtAfterReschedule = current?.trigger_at ?? null

  // Partial PATCH: only trigger_at.
  const partial = await raw('PATCH', `/feed/comment/${draftA.id}`, { trigger_at: null })
  current = await findDraft(draftA.id)
  phaseA.partialPatch = {
    status: partial.status,
    error: partial.status >= 400 ? partial.json : undefined,
    bodyKept: current?.body?.includes('A edited') ?? null,
    attachmentsAfter: current?.attachments?.length ?? null,
    triggerAtAfter: current ? (current.trigger_at ?? null) : 'draft missing'
  }

  // Empty attachment list.
  await attempt('A8', 'update with empty attachmentIds', () =>
    client.updateScheduledNote(draftA.id, { bodyJson: body('A edited'), replyMinimumRole: 'everyone', attachmentIds: [], triggerAt: inDays(7) })
  )
  current = await findDraft(draftA.id)
  phaseA.attachmentsAfterEmptyList = current?.attachments?.length ?? null

  // A6: delete a far-future draft, then delete it again.
  const firstDelete = await raw('DELETE', `/comment/${draftA.id}`)
  const secondDelete = await raw('DELETE', `/comment/${draftA.id}`)
  cleanup.delete(draftA.id)
  phaseA.deleteFarFuture = { first: firstDelete.status, second: secondDelete.status }

  // A3: real multi-page cursor with three unscheduled drafts.
  const pageDrafts: number[] = []
  for (const label of ['P1', 'P2', 'P3']) {
    const draft = await client.createDraftNote({ bodyJson: body(label), replyMinimumRole: 'everyone' })
    pageDrafts.push(draft.id)
    cleanup.add(draft.id)
  }
  const page1 = await client.getDraftNotes({ limit: 1 })
  const page2 = page1.nextCursor ? await client.getDraftNotes({ limit: 1, cursor: page1.nextCursor }) : undefined
  const all = await client.getAllDraftNotes({ pageSize: 1, maxItems: 1_000 })
  phaseA.pagination = {
    page1Count: page1.drafts?.length,
    page1HasMore: page1.hasMore,
    page1CursorType: typeof page1.nextCursor,
    page2Count: page2?.drafts?.length ?? null,
    pagesDiffer: page2 ? page1.drafts?.[0]?.id !== page2.drafts?.[0]?.id : null,
    getAllFindsAllThree: pageDrafts.every((id) => all.some((draft) => draft.id === id))
  }
  for (const id of pageDrafts) {
    await client.deleteNote(id)
    cleanup.delete(id)
  }
  report.phaseA = phaseA
  event('phaseA', 'done', phaseA)

  // ---------- Phase B: publishing, lead time, punctuality, races ----------
  type Probe = {
    label: string
    kind: 'lead' | 'race' | 'postNow'
    requestedTriggerAt?: string
    id?: number
    storedTriggerAt?: string | null
    create?: unknown
    deleteAt?: number
    deleteResult?: { status: number; serverDate: string | null; sentAt: string }
    draftGoneAt?: string
    sameIdPublished?: boolean
    sameIdFirstSeenPublishedAt?: string
    publishedId?: number
    publishedDate?: string
    publishedBodyJson?: unknown
    resolved?: boolean
  }
  const probes: Probe[] = []
  const hardBreakBody = {
    type: 'doc',
    attrs: { schemaVersion: 'v1', title: null },
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `${text('lead60')} Line one.` },
          { type: 'hardBreak' },
          { type: 'hardBreak' },
          { type: 'text', text: 'Line three after two hard breaks.' }
        ]
      },
      { type: 'paragraph', content: [] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Paragraph after an empty paragraph.' }] }
    ]
  }

  async function schedule(probe: Probe, offsetMs: number, bodyJson: unknown = body(probe.label)) {
    probe.requestedTriggerAt = iso(Date.now() + offsetMs)
    try {
      const draft = await client.scheduleNote({
        bodyJson,
        tabId: 'for-you',
        surface: 'feed',
        replyMinimumRole: 'everyone',
        triggerAt: probe.requestedTriggerAt
      })
      probe.id = draft.id
      probe.storedTriggerAt = draft.trigger_at ?? null
      probe.create = { status: 200 }
      cleanup.add(draft.id)
    } catch (error) {
      probe.create = errorInfo(error)
      probe.resolved = true
    }
    probes.push(probe)
    event(probe.label, 'scheduled', { requested: probe.requestedTriggerAt, stored: probe.storedTriggerAt, create: probe.create })
  }

  await schedule({ label: 'past60', kind: 'lead' }, -60_000)
  await schedule({ label: 'lead30', kind: 'lead' }, 30_000)
  await schedule({ label: 'lead60', kind: 'lead' }, 60_000, hardBreakBody)
  await schedule({ label: 'lead90', kind: 'lead' }, 90_000)
  const raceBase = Date.now() + 150_000
  for (const offset of [-10, -2, 0, 2, 5]) {
    const probe: Probe = { label: `race${offset >= 0 ? '+' : ''}${offset}`, kind: 'race' }
    await schedule(probe, raceBase - Date.now())
    probe.deleteAt = Date.parse(probe.storedTriggerAt ?? probe.requestedTriggerAt!) + offset * 1_000
  }

  // Post now: publish an existing draft with draftCommentId.
  const postNow: Probe = { label: 'postNow', kind: 'postNow' }
  const postNowDraft = await client.createDraftNote({ bodyJson: body('postNow'), replyMinimumRole: 'everyone' })
  cleanup.add(postNowDraft.id)
  postNow.id = postNowDraft.id
  try {
    const published = await client.publishNote({
      bodyJson: body('postNow'),
      tabId: 'for-you',
      surface: 'feed',
      replyMinimumRole: 'everyone',
      draftCommentId: postNowDraft.id
    })
    postNow.publishedId = published.id
    postNow.publishedDate = published.date as string | undefined
    postNow.create = { status: 200 }
    cleanup.add(published.id)
  } catch (error) {
    postNow.create = errorInfo(error)
  }
  postNow.sameIdPublished = postNow.publishedId === postNowDraft.id
  postNow.draftGoneAt = (await findDraft(postNowDraft.id)) ? undefined : iso(Date.now())
  postNow.resolved = true
  probes.push(postNow)
  event('postNow', 'published from draft', {
    sameId: postNow.sameIdPublished,
    draftStillListed: postNow.draftGoneAt === undefined,
    create: postNow.create
  })
  if (postNow.publishedId) {
    await raw('DELETE', `/comment/${postNow.publishedId}`)
    cleanup.delete(postNow.publishedId)
  }
  if (postNow.draftGoneAt === undefined) {
    await raw('DELETE', `/comment/${postNowDraft.id}`)
  }
  cleanup.delete(postNowDraft.id)

  // Fire race deletes on time, with a tight reader poll around each trigger.
  for (const probe of probes.filter((entry) => entry.kind === 'race' && entry.id && entry.deleteAt)) {
    const trigger = Date.parse(probe.storedTriggerAt ?? probe.requestedTriggerAt!)
    setTimeout(async () => {
      while (!probe.deleteResult || Date.now() < Date.parse(probe.deleteResult.sentAt) + 1_500) {
        const read = await readComment(probe.id!)
        if (!probe.sameIdPublished && looksPublished(read)) {
          probe.sameIdPublished = true
          probe.sameIdFirstSeenPublishedAt = iso(Date.now())
          probe.publishedId = probe.id
          probe.publishedDate = read.date
          event(probe.label, 'published under the draft ID (tight poll)', { publishedDate: read.date })
        }
        if (Date.now() > trigger + 30_000) break
        await sleep(500)
      }
    }, Math.max(0, trigger - 3_000 - Date.now()))
    setTimeout(async () => {
      const sentAt = iso(Date.now())
      const result = await raw('DELETE', `/comment/${probe.id}`)
      probe.deleteResult = { status: result.status, serverDate: result.serverDate, sentAt }
      event(probe.label, 'race delete', probe.deleteResult)
    }, Math.max(0, probe.deleteAt! - Date.now()))
  }

  const latestTrigger = Math.max(...probes.map((probe) => Date.parse(probe.storedTriggerAt ?? probe.requestedTriggerAt ?? iso(0))))
  const deadline = latestTrigger + 240_000
  while (Date.now() < deadline && probes.some((probe) => !probe.resolved)) {
    const listed = new Set((await client.getAllDraftNotes({ maxItems: 1_000 })).map((draft) => draft.id))
    for (const probe of probes.filter((entry) => !entry.resolved && entry.id)) {
      const trigger = Date.parse(probe.storedTriggerAt ?? probe.requestedTriggerAt!)
      if (!listed.has(probe.id!) && !probe.draftGoneAt) {
        probe.draftGoneAt = iso(Date.now())
        event(probe.label, 'draft no longer listed', { secondsAfterTrigger: (Date.now() - trigger) / 1000 })
      }
      if (Date.now() >= trigger - 5_000 && !probe.sameIdPublished) {
        const read = await readComment(probe.id!)
        if (looksPublished(read)) {
          probe.sameIdPublished = true
          probe.sameIdFirstSeenPublishedAt = iso(Date.now())
          probe.publishedId = probe.id
          probe.publishedDate = read.date
          event(probe.label, 'published under the draft ID', { publishedDate: read.date })
        }
      }
    }

    const notes = await authoredMarkerNotes()
    for (const note of notes) {
      const probe = probes.find((entry) => note.body.includes(`${marker} ${entry.label})`))
      if (!probe || probe.kind === 'postNow') continue
      if (!probe.publishedId) {
        probe.publishedId = note.id
        probe.publishedDate = note.date
        probe.sameIdPublished = note.id === probe.id
        event(probe.label, 'found in authored feed', { sameId: probe.sameIdPublished, publishedDate: note.date })
      }
      probe.publishedBodyJson ??= note.body_json
      cleanup.add(note.id)
    }

    // Resolve: published (record, then delete) or gone well after its trigger.
    for (const probe of probes.filter((entry) => !entry.resolved && entry.id)) {
      const trigger = Date.parse(probe.storedTriggerAt ?? probe.requestedTriggerAt!)
      const raceSettled = probe.kind !== 'race' || probe.deleteResult
      if (probe.publishedId && raceSettled) {
        if (probe.kind === 'race') await sleep(3_000)
        const final = await readComment(probe.publishedId)
        event(probe.label, 'resolved: published', { stillVisibleBeforeCleanup: final.exists })
        await raw('DELETE', `/comment/${probe.publishedId}`)
        probe.resolved = true
      } else if (probe.draftGoneAt && raceSettled && Date.now() > trigger + 120_000) {
        event(probe.label, 'resolved: never published')
        probe.resolved = true
      }
    }
    await sleep(2_000)
  }

  report.probes = probes.map((probe) => {
    const trigger = probe.storedTriggerAt ?? probe.requestedTriggerAt
    const delay = (value?: string | null) =>
      value && trigger ? Number(((Date.parse(value) - Date.parse(trigger)) / 1000).toFixed(1)) : null
    return {
      ...probe,
      publishDelaySeconds: delay(probe.publishedDate),
      draftGoneSecondsAfterTrigger: delay(probe.draftGoneAt),
      deleteSentSecondsAfterTrigger: delay(probe.deleteResult?.sentAt),
      deleteServerSecondsAfterTrigger: delay(probe.deleteResult?.serverDate ? iso(Date.parse(probe.deleteResult.serverDate)) : null)
    }
  })
}

try {
  await main()
} catch (error) {
  report.fatal = errorInfo(error)
  console.error('Fatal:', report.fatal)
} finally {
  // Final sweep: delete every ID we created plus any marker Note still visible.
  if (myUserId) {
    for (const note of await authoredMarkerNotes().catch(() => [])) cleanup.add(note.id)
  }
  for (const draft of await client.getAllDraftNotes({ maxItems: 1_000 }).catch(() => [])) {
    if (typeof draft.body === 'string' && draft.body.includes(marker)) cleanup.add(draft.id)
  }
  const cleanupResults: Record<string, number> = {}
  for (const id of cleanup) cleanupResults[id] = (await raw('DELETE', `/comment/${id}`)).status
  const leftoverDrafts = (await client.getAllDraftNotes({ maxItems: 1_000 }).catch(() => [])).filter(
    (draft) => typeof draft.body === 'string' && draft.body.includes(marker)
  ).length
  const leftoverNotes = myUserId ? (await authoredMarkerNotes().catch(() => [])).length : null
  report.cleanup = { attempted: cleanupResults, leftoverDrafts, leftoverNotes }
  report.events = events
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nCleanup: leftover drafts=${leftoverDrafts}, leftover Notes=${leftoverNotes}. Report: ${reportPath}`)
}
