import { describe, expect, test } from 'bun:test'
import { SubstackApiError, SubstackConfigurationError } from '../src/index.js'
import { clientFromEnvironment, createToolHandlers } from '../src/mcp-server.js'

const mockClient = (overrides: Record<string, unknown> = {}) => ({
  getProfilePosts: async () => ({ posts: [{ id: 1 }, { id: 2 }] }),
  getEmailStats: async () => ({ rows: [{ post_id: 1 }] }),
  getPostWithEngagement: async () => ({
    post: { id: 1, title: 'Post' },
    comments: [],
    commentItems: [],
    engagement: { visibleCommentCount: 0 }
  }),
  getNotes: async () => ({ items: [{ id: 1 }, { id: 2 }] }),
  ...overrides
})

describe('MCP tools', () => {
  test('returns capped structured data from SDK responses', async () => {
    const tools = createToolHandlers(mockClient() as never)

    expect((await tools.getRecentPosts(7, 1)).structuredContent).toEqual({
      data: { posts: [{ id: 1 }] }
    })
    expect((await tools.getNotes(undefined, 1)).structuredContent).toEqual({
      data: { items: [{ id: 1 }] }
    })
  })

  test('returns a compact content analysis', async () => {
    const result = await createToolHandlers(mockClient() as never).analyzeContent(1)

    expect(result.structuredContent).toEqual({
      data: {
        post: { id: 1, title: 'Post' },
        engagement: { visibleCommentCount: 0 }
      }
    })
  })

  test('limits comments returned with post engagement', async () => {
    const client = mockClient({
      getPostWithEngagement: async () => ({
        post: { id: 1 },
        comments: [],
        commentItems: [{ id: 1 }, { id: 2 }],
        engagement: { visibleCommentCount: 2 }
      })
    })
    const result = await createToolHandlers(client as never).getPostEngagement(1, 1)

    expect(result.structuredContent).toEqual({
      data: {
        post: { id: 1 },
        engagement: { visibleCommentCount: 2 },
        comments: [{ id: 1 }]
      }
    })
  })

  test('turns authentication failures into friendly tool errors', async () => {
    const tools = createToolHandlers(
      mockClient({
        getEmailStats: async () => {
          throw new SubstackApiError('Request failed.', 401, 'https://example.com')
        }
      }) as never
    )
    const response = await tools.getEmailStats({})

    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain('authentication failed')
  })

  test('requires both environment variables', () => {
    expect(() => clientFromEnvironment({})).toThrow(SubstackConfigurationError)
  })
})
