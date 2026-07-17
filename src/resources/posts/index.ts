import { SubstackApiError } from '../../core/errors.js'
import type { EndpointContext } from '../../core/transport.js'
import { positiveInteger } from '../../core/validation.js'
import type {
  PostWithEngagement,
  PostWithEngagementOptions,
  SubstackPostComment
} from '../../core/types.js'
import { getPostComments } from '../notes/index.js'

type PostEnvelope = {
  post?: unknown
  publication?: unknown
  publicationSettings?: unknown
}

type PostCommentsEnvelope = {
  comments?: unknown
  automod_hidden_comments?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown, message: string, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SubstackApiError(message, 502, path)
  }
  return value
}

function asCommentTree(value: unknown, path: string): SubstackPostComment[] {
  if (!Array.isArray(value)) {
    throw new SubstackApiError('Substack returned a post-comments response without a comments array.', 502, path)
  }

  const visit = (comments: unknown[]): SubstackPostComment[] =>
    comments.map((comment) => {
      const record = asRecord(
        comment,
        'Substack returned a post-comments response with an invalid comment.',
        path
      )
      if (Array.isArray(record.children)) {
        visit(record.children)
      }
      return record as SubstackPostComment
    })

  return visit(value)
}

function flattenCommentTree(comments: SubstackPostComment[]): SubstackPostComment[] {
  const items: SubstackPostComment[] = []
  const visit = (nodes: SubstackPostComment[]) => {
    for (const comment of nodes) {
      items.push(comment)
      if (Array.isArray(comment.children)) {
        visit(comment.children)
      }
    }
  }

  visit(comments)
  return items
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function sumCommentMetric(comments: SubstackPostComment[], field: 'reaction_count' | 'restacks'): number {
  return comments.reduce((sum, comment) => sum + (nonNegativeNumber(comment[field]) ?? 0), 0)
}

export function getPost<T = unknown>(context: EndpointContext, id: string | number): Promise<T> {
  return context.global(`/posts/by-id/${encodeURIComponent(String(positiveInteger(id, 'Post ID')))}`)
}

/**
 * Fetches a full post and its comments concurrently, retaining visible comment
 * threads while deriving convenience engagement totals from the response.
 */
export async function getPostWithEngagement(
  context: EndpointContext,
  id: string | number,
  options: PostWithEngagementOptions = {}
): Promise<PostWithEngagement> {
  const postId = positiveInteger(id, 'Post ID')
  const [postPayload, commentsPayload] = await Promise.all([
    getPost<PostEnvelope>(context, postId),
    getPostComments<PostCommentsEnvelope>(context, postId)
  ])
  const postEnvelope = asRecord(
    postPayload,
    'Substack returned a post response without a post object.',
    `/posts/by-id/${postId}`
  ) as PostEnvelope
  const post = asRecord(
    postEnvelope.post,
    'Substack returned a post response without a post object.',
    `/posts/by-id/${postId}`
  )
  const commentsEnvelope = asRecord(
    commentsPayload,
    'Substack returned an invalid post-comments response.',
    `/post/${postId}/comments`
  ) as PostCommentsEnvelope
  const comments = asCommentTree(commentsEnvelope.comments, `/post/${postId}/comments`)
  const commentItems = flattenCommentTree(comments)
  const automodHiddenComments = Array.isArray(commentsEnvelope.automod_hidden_comments)
    ? asCommentTree(commentsEnvelope.automod_hidden_comments, `/post/${postId}/comments`)
    : []

  return {
    post,
    publication: postEnvelope.publication,
    publicationSettings: postEnvelope.publicationSettings,
    comments,
    commentItems,
    ...(options.includeAutomodHidden ? { automodHiddenComments } : {}),
    engagement: {
      reactions: post.reactions,
      reactionCount: nonNegativeNumber(post.reaction_count),
      restackCount: nonNegativeNumber(post.restacks),
      reportedCommentCount: nonNegativeNumber(post.comment_count),
      reportedReplyCount: nonNegativeNumber(post.child_comment_count),
      visibleRootCommentCount: comments.length,
      visibleCommentCount: commentItems.length,
      visibleReplyCount: commentItems.length - comments.length,
      commentReactionCount: sumCommentMetric(commentItems, 'reaction_count'),
      commentRestackCount: sumCommentMetric(commentItems, 'restacks')
    }
  }
}
