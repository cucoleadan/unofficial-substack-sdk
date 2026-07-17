import type { EndpointContext } from '../../core/transport.js'
import { positiveInteger } from '../../core/validation.js'
import type {
  CreateAttachmentRequest,
  CursorOptions,
  DraftNotesOptions,
  DraftNotesPage,
  PublishNoteRequest,
  ScheduleNoteRequest,
  UploadedImage,
  UpdateScheduledNoteRequest
} from '../../core/types.js'

function cursorQuery(options?: CursorOptions): string {
  return options?.cursor ? `?cursor=${encodeURIComponent(options.cursor)}` : ''
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

export function getProfileNotes(
  context: EndpointContext,
  id: number | string,
  options: CursorOptions = {}
): Promise<unknown> {
  const profileId = positiveInteger(id, 'Profile ID')
  const query = new URLSearchParams({ types: 'note' })
  if (options.cursor) {
    query.set('cursor', options.cursor)
  }
  return context.publication(`/reader/feed/profile/${profileId}?${query.toString()}`)
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
  return context.post('/comment/feed/', request)
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
