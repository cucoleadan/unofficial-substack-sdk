import type { EndpointContext } from '../../core/transport.js'
import { positiveInteger } from '../../core/validation.js'

export function getPost(context: EndpointContext, id: string | number): Promise<unknown> {
  return context.global(`/posts/by-id/${encodeURIComponent(String(positiveInteger(id, 'Post ID')))}`)
}
