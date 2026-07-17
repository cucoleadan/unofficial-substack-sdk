import type { EndpointContext } from '../../core/transport.js'
import { positiveInteger } from '../../core/validation.js'
import type { CreateAttachmentRequest, CursorOptions, PublishNoteRequest } from '../../core/types.js'

function cursorQuery(options?: CursorOptions): string {
  return options?.cursor ? `?cursor=${encodeURIComponent(options.cursor)}` : ''
}

export function getNotes(context: EndpointContext, options: CursorOptions = {}): Promise<unknown> {
  return context.publication(`/notes${cursorQuery(options)}`)
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

export function getPostComments<T = unknown>(context: EndpointContext, id: number | string): Promise<T> {
  return context.publication(`/post/${positiveInteger(id, 'Post ID')}/comments`)
}

export function createAttachment(context: EndpointContext, request: CreateAttachmentRequest): Promise<unknown> {
  return context.post('/comment/attachment/', request)
}

export function publishNote(context: EndpointContext, request: PublishNoteRequest): Promise<unknown> {
  return context.post('/comment/feed/', request)
}
