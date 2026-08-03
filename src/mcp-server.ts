import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { SubstackApiError, SubstackClient, SubstackConfigurationError } from './index.js'

type ReadOnlyClient = Pick<
  SubstackClient,
  'getProfilePosts' | 'getEmailStats' | 'getPostWithEngagement' | 'getNotes'
>

type ToolResult = {
  content: [{ type: 'text'; text: string }]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

const id = z.union([z.number().int().positive(), z.string().min(1)])
const limit = z.number().int().min(1).max(50).default(20)

function result(data: unknown): ToolResult {
  const output = { data }
  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    structuredContent: output
  }
}

function failure(error: unknown): ToolResult {
  let message = error instanceof Error ? error.message : 'Unknown error.'
  if (error instanceof SubstackApiError && (error.status === 401 || error.status === 403)) {
    message = 'Substack authentication failed. Check SUBSTACK_SESSION_TOKEN and publication access.'
  } else if (error instanceof SubstackConfigurationError) {
    message = `Configuration error: ${message}`
  }
  return { content: [{ type: 'text', text: message }], isError: true }
}

function capped(data: unknown, maximum: number): unknown {
  if (Array.isArray(data)) return data.slice(0, maximum)
  if (!data || typeof data !== 'object') return data
  const output = { ...(data as Record<string, unknown>) }
  for (const key of ['posts', 'items', 'rows']) {
    if (Array.isArray(output[key])) output[key] = output[key].slice(0, maximum)
  }
  return output
}

export function createToolHandlers(client: ReadOnlyClient) {
  const run = async (work: () => Promise<unknown>) => {
    try {
      return result(await work())
    } catch (error) {
      return failure(error)
    }
  }

  return {
    getRecentPosts: (profileId: string | number, maximum = 20) =>
      run(async () => capped(await client.getProfilePosts(profileId, { limit: maximum }), maximum)),
    getEmailStats: (options: Parameters<SubstackClient['getEmailStats']>[0]) =>
      run(() => client.getEmailStats(options)),
    getPostEngagement: (postId: string | number, maximum = 20) =>
      run(async () => {
        const { post, engagement, commentItems } = await client.getPostWithEngagement(postId)
        return { post, engagement, comments: commentItems.slice(0, maximum) }
      }),
    getNotes: (cursor: string | undefined, maximum = 20) =>
      run(async () => capped(await client.getNotes({ cursor }), maximum)),
    analyzeContent: (postId: string | number) =>
      run(async () => {
        const { post, engagement } = await client.getPostWithEngagement(postId)
        return {
          post: {
            id: post.id,
            title: post.title,
            subtitle: post.subtitle,
            wordcount: post.wordcount
          },
          engagement
        }
      })
  }
}

export function createMcpServer(client: ReadOnlyClient): McpServer {
  const server = new McpServer({ name: 'substack-mcp', version: '0.1.0' })
  const tools = createToolHandlers(client)

  server.registerTool(
    'get_recent_posts',
    {
      description: 'Get recent posts for a Substack profile.',
      inputSchema: { profile_id: id, limit }
    },
    ({ profile_id, limit }) => tools.getRecentPosts(profile_id, limit)
  )
  server.registerTool(
    'get_email_stats',
    {
      description: 'Get publication email performance statistics.',
      inputSchema: {
        offset: z.number().int().nonnegative().default(0),
        limit,
        order_by: z.string().min(1).default('post_date'),
        order_direction: z.enum(['asc', 'desc']).default('desc')
      }
    },
    ({ offset, limit, order_by, order_direction }) =>
      tools.getEmailStats({ offset, limit, orderBy: order_by, orderDirection: order_direction })
  )
  server.registerTool(
    'get_post_engagement',
    {
      description: 'Get a post, its visible comments, and engagement totals.',
      inputSchema: { post_id: id, comment_limit: limit }
    },
    ({ post_id, comment_limit }) => tools.getPostEngagement(post_id, comment_limit)
  )
  server.registerTool(
    'get_notes',
    {
      description: 'Get a page of publication Notes.',
      inputSchema: { cursor: z.string().optional(), limit }
    },
    ({ cursor, limit }) => tools.getNotes(cursor, limit)
  )
  server.registerTool(
    'analyze_content',
    {
      description: 'Return a compact post and engagement summary.',
      inputSchema: { post_id: id }
    },
    ({ post_id }) => tools.analyzeContent(post_id)
  )

  return server
}

export function clientFromEnvironment(env: Record<string, string | undefined>): SubstackClient {
  const sessionToken = env.SUBSTACK_SESSION_TOKEN?.trim()
  const publicationUrl = env.SUBSTACK_PUBLICATION_URL?.trim()
  if (!sessionToken || !publicationUrl) {
    throw new SubstackConfigurationError(
      'SUBSTACK_SESSION_TOKEN and SUBSTACK_PUBLICATION_URL are required.'
    )
  }
  return new SubstackClient({ sessionToken, publicationUrl })
}
