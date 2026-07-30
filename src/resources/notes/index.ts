import type { EndpointContext } from '../../core/transport.js'
import { boundedString, positiveInteger } from '../../core/validation.js'
import type {
  CreateAttachmentRequest,
  CursorOptions,
  DraftNotesOptions,
  DraftNotesPage,
  NoteCommentOptions,
  NoteLikeOptions,
  NoteRestackOptions,
  ProfileNoteItem,
  ProfileNotesPage,
  PublishNoteRequest,
  ScheduleNoteRequest,
  UploadedImage,
  UpdateScheduledNoteRequest
} from '../../core/types.js'

const DEFAULT_TAB_ID = 'for-you'

function cursorQuery(options?: CursorOptions): string {
  return options?.cursor ? `?cursor=${encodeURIComponent(options.cursor)}` : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function viewerHasLiked(item: Record<string, unknown>): boolean | null {
  if (!isRecord(item.comment)) {
    return null
  }

  const reaction = item.comment.reaction
  if (reaction === '❤') {
    return true
  }
  if (reaction === undefined || reaction === null || reaction === false) {
    return false
  }
  return null
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

export function getNotes(context: EndpointContext, options: CursorOptions = {}): Promise<unknown> {
  return context.publication(`/notes${cursorQuery(options)}`)
}

/** Returns scheduled Note drafts for the authenticated account. */
export function getDraftNotes<T = unknown>(
  context: EndpointContext,
  options: DraftNotesOptions = {}
): Promise<DraftNotesPage<T>> {
  const limit = positiveInteger(options.limit ?? 20, 'Draft notes limit')
  return context.global(`/feed/drafts?limit=${limit}`)
}

export async function getProfileNotes<
  T extends Record<string, unknown> = Record<string, unknown>
>(
  context: EndpointContext,
  id: number | string,
  options: CursorOptions = {}
): Promise<ProfileNotesPage<T>> {
  const profileId = positiveInteger(id, 'Profile ID')
  const query = new URLSearchParams({ types: 'note' })
  if (options.cursor) {
    query.set('cursor', options.cursor)
  }
  const response = await context.publication<unknown>(
    `/reader/feed/profile/${profileId}?${query.toString()}`
  )

  if (!isRecord(response) || !Array.isArray(response.items)) {
    return response as ProfileNotesPage<T>
  }

  const items = response.items.map((item) =>
    isRecord(item)
      ? ({ ...item, viewerHasLiked: viewerHasLiked(item) } as ProfileNoteItem<T>)
      : item
  )

  return { ...response, items } as ProfileNotesPage<T>
}

export function getNote(context: EndpointContext, id: number | string): Promise<unknown> {
  return context.publication(`/reader/comment/${positiveInteger(id, 'Note ID')}`)
}

export function getComment(context: EndpointContext, id: number | string): Promise<unknown> {
  return context.publication(`/reader/comment/${positiveInteger(id, 'Comment ID')}`)
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
