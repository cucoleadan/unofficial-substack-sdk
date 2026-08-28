import { SubstackApiError } from '../../core/errors.js'
import type { EndpointContext } from '../../core/transport.js'
import { boundedString, positiveInteger } from '../../core/validation.js'
import type {
  CreateAttachmentRequest,
  CursorOptions,
  DraftNotesOptions,
  DraftNotesPage,
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
  ScheduleNoteRequest,
  UploadedImage,
  UpdateScheduledNoteRequest
} from '../../core/types.js'
import { getAuthenticatedProfile } from '../profiles/index.js'

const DEFAULT_TAB_ID = 'for-you'

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

/** Returns scheduled Note drafts for the authenticated account. */
export function getDraftNotes<T = unknown>(
  context: EndpointContext,
  options: DraftNotesOptions = {}
): Promise<DraftNotesPage<T>> {
  const limit = positiveInteger(options.limit ?? 20, 'Draft notes limit')
  return context.global(`/feed/drafts?limit=${limit}`)
}

export function getProfileNotes<
  T extends Record<string, unknown> = NoteFeedItem
>(
  context: EndpointContext,
  id: number | string,
  options: ProfileNotesOptions = {}
): Promise<ProfileNotesPage<T>> {
  const profileId = positiveInteger(id, 'Profile ID')
  const query = new URLSearchParams({ types: 'note' })
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

export function createAttachment(context: EndpointContext, request: CreateAttachmentRequest): Promise<unknown> {
  return context.post('/comment/attachment', request)
}

/** Uploads a data-URL image and returns its Substack media metadata. */
export function uploadImage(context: EndpointContext, image: string): Promise<UploadedImage> {
  return context.post('/image', { image })
}

/** Creates a Note image attachment from a previously uploaded image. */
export function createImageAttachment(context: EndpointContext, image: UploadedImage): Promise<unknown> {
  return createAttachment(context, {
    url: image.url,
    type: 'image',
  })
}

export function publishNote(context: EndpointContext, request: PublishNoteRequest): Promise<unknown> {
  return context.post('/comment/feed', request)
}

/** Creates a scheduled Note draft. The API expects trigger_at in snake_case. */
export function scheduleNote(context: EndpointContext, request: ScheduleNoteRequest): Promise<unknown> {
  const { triggerAt, ...note } = request
  return context.post('/comment/draft', { ...note, trigger_at: triggerAt })
}

/** Updates a scheduled Note draft. The API expects trigger_at in snake_case. */
export function updateScheduledNote(
  context: EndpointContext,
  id: number | string,
  request: UpdateScheduledNoteRequest
): Promise<unknown> {
  const { triggerAt, ...note } = request
  return context.patch(`/feed/comment/${positiveInteger(id, 'Scheduled Note ID')}`, {
    ...note,
    trigger_at: triggerAt
  })
}
