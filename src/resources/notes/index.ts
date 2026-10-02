import { SubstackApiError, SubstackConfigurationError } from '../../core/errors.js'
import type { EndpointContext } from '../../core/transport.js'
import { boundedString, positiveInteger } from '../../core/validation.js'
import type {
  AllDraftNotesOptions,
  CreateAttachmentRequest,
  CreateDraftNoteRequest,
  CursorOptions,
  DraftNote,
  DraftNotesOptions,
  DraftNotesPage,
  ImageUploadData,
  NoteAttachment,
  NoteCommentOptions,
  NoteComment,
  NoteEngagement,
  NoteFeedItem,
  NoteLikeOptions,
  NoteReplyBranch,
  NoteRepliesResponse,
  NoteResponse,
  NoteRestackOptions,
  NotesOptions,
  NoteWithEngagement,
  ProfileNotesOptions,
  ProfileNotesPage,
  PublishNoteRequest,
  PublishNoteResponse,
  ScheduleNoteRequest,
  ScheduledNoteResponse,
  UploadedImage,
  UnscheduleNoteRequest,
  UploadImageOptions,
  UpdateScheduledNoteRequest
} from '../../core/types.js'
import { getAuthenticatedProfile } from '../profiles/index.js'

const DEFAULT_TAB_ID = 'for-you'
const DRAFT_NOTES_PATH = '/feed/drafts'
const DEFAULT_DRAFT_NOTES_LIMIT = 20
/** Substack rejects larger draft page sizes with HTTP 400. */
const MAX_DRAFT_NOTES_LIMIT = 100
const DEFAULT_MAX_DRAFT_ITEMS = 500
const MAX_DRAFT_ITEMS = 10_000

function cursorQuery(options?: CursorOptions): string {
  return options?.cursor ? `?cursor=${encodeURIComponent(options.cursor)}` : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function noteBodyJson(body: string): Record<string, unknown> {
  return {
    type: 'doc',
    attrs: { schemaVersion: 'v1', title: null },
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: body }]
      }
    ]
  }
}

export async function getNotes<
  T extends Record<string, unknown> = NoteFeedItem
>(
  context: EndpointContext,
  options: NotesOptions = {}
): Promise<ProfileNotesPage<T>> {
  let profileId = options.profileId
  if (!profileId) {
    const profile = (await getAuthenticatedProfile(context)) as { id?: number | string }
    if (!profile?.id) {
      throw new SubstackApiError('Authenticated Substack profile ID was not found.', 502, '/handle/options')
    }
    profileId = profile.id
  }
  return getProfileNotes<T>(context, profileId, options)
}

function boundedPositiveInteger(value: number | string, name: string, maximum: number): number {
  const parsed = positiveInteger(value, name)
  if (parsed > maximum) {
    throw new SubstackConfigurationError(`${name} must be at most ${maximum.toLocaleString('en-US')}.`)
  }
  return parsed
}

/** Returns one page of scheduled and unscheduled Note drafts. */
export function getDraftNotes<T = DraftNote>(
  context: EndpointContext,
  options: DraftNotesOptions = {}
): Promise<DraftNotesPage<T>> {
  const limit = boundedPositiveInteger(
    options.limit ?? DEFAULT_DRAFT_NOTES_LIMIT,
    'Draft notes limit',
    MAX_DRAFT_NOTES_LIMIT
  )
  const query = new URLSearchParams({ limit: String(limit) })
  if (options.cursor) {
    query.set('cursor', options.cursor)
  }
  return context.global(`${DRAFT_NOTES_PATH}?${query.toString()}`)
}

/**
 * Follows draft-page cursors until Substack reports no further page or
 * `maxItems` drafts are collected. A repeated cursor, a missing `drafts`
 * array, or `hasMore: true` without a cursor throws rather than being treated
 * as the end of the list.
 */
export async function getAllDraftNotes<T = DraftNote>(
  context: EndpointContext,
  options: AllDraftNotesOptions = {}
): Promise<T[]> {
  const maxItems = boundedPositiveInteger(
    options.maxItems ?? DEFAULT_MAX_DRAFT_ITEMS,
    'Draft notes maxItems',
    MAX_DRAFT_ITEMS
  )
  const pageSize = boundedPositiveInteger(
    options.pageSize ?? MAX_DRAFT_NOTES_LIMIT,
    'Draft notes pageSize',
    MAX_DRAFT_NOTES_LIMIT
  )
  const drafts: T[] = []
  const seenIds = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  while (drafts.length < maxItems) {
    const page = await getDraftNotes<T>(context, {
      limit: Math.min(pageSize, maxItems - drafts.length),
      cursor
    })
    if (!Array.isArray(page.drafts)) {
      throw new SubstackApiError(
        'Substack returned a drafts response without a drafts array.',
        502,
        DRAFT_NOTES_PATH
      )
    }

    for (const draft of page.drafts) {
      const id = isRecord(draft) && draft.id !== undefined ? String(draft.id) : undefined
      if (id !== undefined) {
        if (seenIds.has(id)) continue
        seenIds.add(id)
      }
      drafts.push(draft)
      if (drafts.length >= maxItems) break
    }

    const nextCursor =
      typeof page.nextCursor === 'string' && page.nextCursor.length > 0 ? page.nextCursor : undefined
    if (!nextCursor) {
      if (page.hasMore === true) {
        throw new SubstackApiError(
          'Substack reported more drafts without a next cursor.',
          502,
          DRAFT_NOTES_PATH
        )
      }
      break
    }
    if (seenCursors.has(nextCursor)) {
      throw new SubstackApiError('Substack repeated a drafts cursor.', 502, DRAFT_NOTES_PATH)
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  return drafts
}

export function getProfileNotes<
  T extends Record<string, unknown> = NoteFeedItem
>(
  context: EndpointContext,
  id: number | string,
  options: ProfileNotesOptions = {}
): Promise<ProfileNotesPage<T>> {
  const profileId = positiveInteger(id, 'Profile ID')
  const query = new URLSearchParams()
  query.append('types[]', 'note')
  if (options.limit !== undefined) {
    query.set('limit', String(positiveInteger(options.limit, 'Profile Notes limit')))
  }
  if (options.cursor) {
    query.set('cursor', options.cursor)
  }
  return context.publication(`/reader/feed/profile/${profileId}?${query.toString()}`)
}

export function getNote<T = NoteResponse>(context: EndpointContext, id: number | string): Promise<T> {
  return context.publication(`/reader/comment/${positiveInteger(id, 'Note ID')}`)
}

export function getComment(context: EndpointContext, id: number | string): Promise<unknown> {
  return context.publication(`/reader/comment/${positiveInteger(id, 'Comment ID')}`)
}

export function getNoteReplies<TBranch = NoteReplyBranch, TRootComment = NoteComment>(
  context: EndpointContext,
  id: number | string,
  options: CursorOptions = {}
): Promise<NoteRepliesResponse<TBranch, TRootComment>> {
  const noteId = positiveInteger(id, 'Note ID')
  const query = new URLSearchParams({ comment_id: String(noteId) })
  if (options.cursor) {
    query.set('cursor', options.cursor)
  }
  return context.global(`/reader/comment/${noteId}/replies?${query.toString()}`)
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function viewerHasLiked(comment: NoteComment): boolean | undefined {
  if (typeof comment.viewer_has_liked === 'boolean') {
    return comment.viewer_has_liked
  }
  if (comment.reaction === '❤') {
    return true
  }
  if (comment.reaction === undefined || comment.reaction === null || comment.reaction === false) {
    return false
  }
  return undefined
}

function viewerHasRestacked(comment: NoteComment): boolean | undefined {
  return typeof comment.viewer_has_restacked === 'boolean'
    ? comment.viewer_has_restacked
    : typeof comment.restacked === 'boolean'
      ? comment.restacked
      : undefined
}

function noteEngagement(
  note: NoteResponse,
  pages: NoteRepliesResponse[]
): { replies: NoteReplyBranch[]; engagement: NoteEngagement } {
  const item = isRecord(note.item) ? note.item : undefined
  const comment = isRecord(item?.comment) ? (item.comment as NoteComment) : undefined
  const replies: NoteReplyBranch[] = []
  let nestedReplyCount = 0
  let replyCountsComplete = true

  for (const page of pages) {
    const moreBranches = nonNegativeNumber(page.moreBranches)
    if (moreBranches !== undefined && moreBranches > 0 && !page.nextCursor) {
      replyCountsComplete = false
    }
    if (!Array.isArray(page.commentBranches)) {
      replyCountsComplete = false
      continue
    }

    for (const branchValue of page.commentBranches) {
      if (!isRecord(branchValue)) {
        replyCountsComplete = false
        continue
      }

      const branch = branchValue as NoteReplyBranch
      replies.push(branch)
      if (!Array.isArray(branch.descendantComments)) {
        replyCountsComplete = false
        continue
      }
      nestedReplyCount += branch.descendantComments.length
    }
  }

  const engagement: NoteEngagement = { replyCountsComplete }
  const reactionCount = nonNegativeNumber(comment?.reaction_count)
  const reportedDirectReplyCount = nonNegativeNumber(comment?.children_count)
  const restackCount = nonNegativeNumber(comment?.restacks)
  const viewCount = nonNegativeNumber(comment?.views) ?? nonNegativeNumber(comment?.view_count)
  const liked = comment ? viewerHasLiked(comment) : undefined
  const restacked = comment ? viewerHasRestacked(comment) : undefined

  if (reactionCount !== undefined) engagement.reactionCount = reactionCount
  if (reportedDirectReplyCount !== undefined) {
    engagement.reportedDirectReplyCount = reportedDirectReplyCount
  }
  if (restackCount !== undefined) engagement.restackCount = restackCount
  if (viewCount !== undefined) engagement.viewCount = viewCount
  if (liked !== undefined) engagement.viewerHasLiked = liked
  if (restacked !== undefined) engagement.viewerHasRestacked = restacked
  if (replyCountsComplete) {
    engagement.directReplyCount = replies.length
    engagement.nestedReplyCount = nestedReplyCount
    engagement.totalReplyCount = replies.length + nestedReplyCount
  }

  return { replies, engagement }
}

/**
 * Fetches a Note plus every cursor-paginated reply branch and returns only
 * reliably derived visible reply totals in the normalized engagement object.
 */
export async function getNoteWithEngagement(
  context: EndpointContext,
  id: number | string
): Promise<NoteWithEngagement> {
  const noteId = positiveInteger(id, 'Note ID')
  const [note, firstReplyPage] = await Promise.all([
    getNote<NoteResponse>(context, noteId),
    getNoteReplies<NoteReplyBranch, NoteComment>(context, noteId)
  ])
  const replyPages: NoteRepliesResponse[] = [firstReplyPage]
  const seenCursors = new Set<string>()
  let cursor = firstReplyPage.nextCursor

  while (typeof cursor === 'string' && cursor) {
    if (seenCursors.has(cursor)) {
      break
    }
    seenCursors.add(cursor)
    const page = await getNoteReplies<NoteReplyBranch, NoteComment>(context, noteId, { cursor })
    replyPages.push(page)
    cursor = page.nextCursor
  }

  const normalized = noteEngagement(note, replyPages)
  if (typeof cursor !== 'undefined' && cursor !== null && cursor !== '') {
    normalized.engagement.replyCountsComplete = false
    delete normalized.engagement.directReplyCount
    delete normalized.engagement.nestedReplyCount
    delete normalized.engagement.totalReplyCount
  }

  return { note, replyPages, ...normalized }
}

/** Permanently deletes a Note or Note draft owned by the authenticated account. */
export function deleteNote(context: EndpointContext, id: number | string): Promise<unknown> {
  return context.remove(`/comment/${positiveInteger(id, 'Note ID')}`)
}

export function setNoteLike<T = unknown>(
  context: EndpointContext,
  id: number | string,
  liked: boolean,
  options: NoteLikeOptions = {}
): Promise<T> {
  const noteId = positiveInteger(id, 'Note ID')
  const payload = {
    publication_id: options.publicationId ?? null,
    reaction: '❤',
    tabId: options.tabId ?? DEFAULT_TAB_ID
  }
  const path = `/comment/${noteId}/reaction`
  return liked ? context.post<T>(path, payload) : context.remove<T>(path, payload)
}

export function commentOnNote<T = unknown>(
  context: EndpointContext,
  id: number | string,
  body: string,
  options: NoteCommentOptions = {}
): Promise<T> {
  const noteId = positiveInteger(id, 'Note ID')
  const validatedBody = boundedString(body, 'Note comment body', 1, 5_000)
  return context.post<T>('/comment/feed', {
    bodyJson: noteBodyJson(validatedBody),
    parent_id: noteId,
    tabId: options.tabId ?? DEFAULT_TAB_ID,
    surface: options.surface ?? 'feed',
    replyMinimumRole: 'everyone'
  })
}

export function deleteComment<T = unknown>(
  context: EndpointContext,
  id: number | string
): Promise<T> {
  return context.remove<T>(`/comment/${positiveInteger(id, 'Comment ID')}`, {})
}

export function setNoteRestack<T = unknown>(
  context: EndpointContext,
  id: number | string,
  restacked: boolean,
  options: NoteRestackOptions = {}
): Promise<T> {
  const payload = {
    postId: null,
    commentId: positiveInteger(id, 'Note ID'),
    tabId: options.tabId ?? DEFAULT_TAB_ID
  }

  return restacked
    ? context.post<T>('/restack/feed', {
        ...payload,
        surface: options.surface ?? 'permalink'
      })
    : context.remove<T>('/restack/feed', payload)
}

export function getPostComments<T = unknown>(context: EndpointContext, id: number | string): Promise<T> {
  return context.publication(`/post/${positiveInteger(id, 'Post ID')}/comments`)
}

export function createAttachment<T = NoteAttachment>(
  context: EndpointContext,
  request: CreateAttachmentRequest
): Promise<T> {
  return context.post<T>('/comment/attachment', request)
}

const IMAGE_CONTENT_TYPE = /^image\/[a-z0-9][a-z0-9.+-]*$/i
const BASE64_CHUNK_SIZE = 0x8000

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE))
  }
  return btoa(binary)
}

async function imageDataUrl(image: ImageUploadData, options: UploadImageOptions): Promise<string> {
  const blob = typeof Blob !== 'undefined' && image instanceof Blob ? image : undefined
  const contentType = (options.contentType ?? blob?.type ?? '').trim().toLowerCase()
  if (!IMAGE_CONTENT_TYPE.test(contentType)) {
    throw new SubstackConfigurationError(
      'An image upload requires an image/* content type, such as image/png.'
    )
  }

  const bytes = blob
    ? new Uint8Array(await blob.arrayBuffer())
    : image instanceof Uint8Array
      ? image
      : new Uint8Array(image as ArrayBuffer)
  if (bytes.length === 0) {
    throw new SubstackConfigurationError('An image upload cannot be empty.')
  }
  return `data:${contentType};base64,${bytesToBase64(bytes)}`
}

/**
 * Uploads an image and returns its Substack media metadata. A string is sent
 * unchanged as a data URL; binary data is encoded with its image content type.
 */
export async function uploadImage(
  context: EndpointContext,
  image: string | ImageUploadData,
  options: UploadImageOptions = {}
): Promise<UploadedImage> {
  const dataUrl = typeof image === 'string' ? image : await imageDataUrl(image, options)
  return context.post('/image', { image: dataUrl })
}

/** Creates a Note image attachment from a previously uploaded image. */
export function createImageAttachment<T = NoteAttachment>(
  context: EndpointContext,
  image: UploadedImage
): Promise<T> {
  return createAttachment<T>(context, {
    url: image.url,
    type: 'image',
  })
}

export function publishNote<T = PublishNoteResponse>(
  context: EndpointContext,
  request: PublishNoteRequest
): Promise<T> {
  return context.post<T>('/comment/feed', request)
}

/** Creates a Note draft. The API expects trigger_at in snake_case. */
export function scheduleNote<T = ScheduledNoteResponse>(
  context: EndpointContext,
  request: ScheduleNoteRequest
): Promise<T> {
  const { triggerAt, ...note } = request
  return context.post<T>('/comment/draft', { ...note, trigger_at: triggerAt })
}

/** Creates an unscheduled Note draft (`trigger_at: null`). */
export function createDraftNote<T = ScheduledNoteResponse>(
  context: EndpointContext,
  request: CreateDraftNoteRequest
): Promise<T> {
  return context.post<T>('/comment/draft', { ...request, trigger_at: null })
}

/** Removes a draft's schedule while keeping the draft and its content. */
export function unscheduleNote<T = ScheduledNoteResponse>(
  context: EndpointContext,
  id: number | string,
  request: UnscheduleNoteRequest
): Promise<T> {
  return context.patch<T>(`/feed/comment/${positiveInteger(id, 'Scheduled Note ID')}`, {
    ...request,
    trigger_at: null
  })
}

/** Updates a Note draft. The API expects trigger_at in snake_case. */
export function updateScheduledNote<T = ScheduledNoteResponse>(
  context: EndpointContext,
  id: number | string,
  request: UpdateScheduledNoteRequest
): Promise<T> {
  const { triggerAt, ...note } = request
  return context.patch<T>(`/feed/comment/${positiveInteger(id, 'Scheduled Note ID')}`, {
    ...note,
    trigger_at: triggerAt
  })
}
