import { SubstackApiError, SubstackConfigurationError } from './errors.js'
import {
  ACTIVITY_FILTERS,
  type ActivityFeed,
  type ActivityFilter,
  type CreateAttachmentRequest,
  type CursorOptions,
  type FetchLike,
  type PublishNoteRequest,
  type ProfilePostsOptions,
  type SubstackClientOptions,
  type UnreadActivityFeed
} from './types.js'

const DEFAULT_BASE_URL = 'https://substack.com'
const DEFAULT_SESSION_COOKIE_NAME = 'substack.sid'
const DEFAULT_API_PREFIX = 'api/v1'

function normalizeOrigin(value: string): URL {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new SubstackConfigurationError('A Substack base URL cannot be empty.')
  }

  try {
    return new URL(trimmed)
  } catch {
    return new URL(`https://${trimmed}`)
  }
}

/**
 * Normalizes a Substack origin into an API base. Query strings and fragments
 * from copied browser URLs are intentionally discarded.
 */
export function apiBase(value: string, prefix = DEFAULT_API_PREFIX): string {
  const url = normalizeOrigin(value)
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '')

  if (!normalizedPrefix) {
    throw new SubstackConfigurationError('A Substack API prefix cannot be empty.')
  }

  url.search = ''
  url.hash = ''
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${normalizedPrefix}/`.replace(/^([^/])/, '/$1')
  return url.toString()
}

function isActivityFilter(value: string): value is ActivityFilter {
  return (ACTIVITY_FILTERS as readonly string[]).includes(value)
}

function positiveInteger(value: number | string, name: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new SubstackConfigurationError(`${name} must be a positive integer.`)
  }
  return parsed
}

function cursorQuery(options?: CursorOptions): string {
  return options?.cursor ? `?cursor=${encodeURIComponent(options.cursor)}` : ''
}

type ProfileFeedItem = {
  context?: {
    users?: Array<{ id?: number | string; handle?: string }>
  }
}

/**
 * Portable, Web-standard client for the observed Substack web API.
 *
 * It intentionally returns upstream JSON unchanged. Consumers can layer their
 * own schemas on top while keeping the client small and predictable.
 */
export class SubstackClient {
  private readonly fetchImpl?: FetchLike
  private readonly globalApiBase: string
  private readonly publicationApiBase?: string
  private readonly sessionCookie: string

  constructor(options: SubstackClientOptions) {
    const sessionToken = options.sessionToken ?? options.token
    if (!sessionToken) {
      throw new SubstackConfigurationError('A Substack session token is required.')
    }

    this.fetchImpl = options.fetch
    this.globalApiBase = apiBase(options.baseUrl ?? options.substackUrl ?? DEFAULT_BASE_URL, options.urlPrefix)
    this.publicationApiBase = options.publicationUrl
      ? apiBase(options.publicationUrl, options.urlPrefix)
      : undefined
    this.sessionCookie = `${options.sessionCookieName ?? DEFAULT_SESSION_COOKIE_NAME}=${sessionToken}`
  }

  async getAuthenticatedProfile(): Promise<unknown> {
    const handles = await this.global<{ potentialHandles?: Array<{ handle: string; type: string }> }>(
      '/handle/options'
    )
    const ownHandle = handles.potentialHandles?.find((handle) => handle.type === 'existing')?.handle

    if (!ownHandle) {
      throw new SubstackApiError('Authenticated Substack profile was not found.', 502, '/handle/options')
    }

    return this.getPublicProfile(ownHandle)
  }

  getPublicProfile(handle: string): Promise<unknown> {
    const normalizedHandle = handle.trim()
    if (!normalizedHandle) {
      throw new SubstackConfigurationError('A profile handle is required.')
    }
    return this.global(`/user/${encodeURIComponent(normalizedHandle)}/public_profile`)
  }

  async getProfileById(id: number | string): Promise<unknown> {
    const profileId = positiveInteger(id, 'Profile ID')
    const feed = await this.global<{ items?: ProfileFeedItem[] }>(`/reader/feed/profile/${profileId}`)
    const user = feed.items
      ?.flatMap((item) => item.context?.users ?? [])
      .find((candidate) => Number(candidate.id) === profileId && typeof candidate.handle === 'string')

    if (!user?.handle) {
      throw new SubstackApiError(`Profile with ID ${profileId} was not found.`, 404, `/reader/feed/profile/${profileId}`)
    }

    return this.getPublicProfile(user.handle)
  }

  getPost(id: string | number): Promise<unknown> {
    return this.global(`/posts/by-id/${encodeURIComponent(String(positiveInteger(id, 'Post ID')))}`)
  }

  getProfilePosts(id: number | string, _options: ProfilePostsOptions = {}): Promise<unknown> {
    const profileId = positiveInteger(id, 'Profile ID')
    return this.global(`/profile/posts?profile_user_id=${profileId}`)
  }

  getNotes(options: CursorOptions = {}): Promise<unknown> {
    return this.publication(`/notes${cursorQuery(options)}`)
  }

  getProfileNotes(id: number | string, options: CursorOptions = {}): Promise<unknown> {
    const profileId = positiveInteger(id, 'Profile ID')
    const query = new URLSearchParams({ types: 'note' })
    if (options.cursor) {
      query.set('cursor', options.cursor)
    }
    return this.publication(`/reader/feed/profile/${profileId}?${query.toString()}`)
  }

  getNote(id: number | string): Promise<unknown> {
    return this.publication(`/reader/comment/${positiveInteger(id, 'Note ID')}`)
  }

  getComment(id: number | string): Promise<unknown> {
    return this.publication(`/reader/comment/${positiveInteger(id, 'Comment ID')}`)
  }

  getPostComments(id: number | string): Promise<unknown> {
    return this.publication(`/post/${positiveInteger(id, 'Post ID')}/comments`)
  }

  /**
   * Creates a link attachment for a Note. Pass the returned attachment ID to
   * `publishNote` as an `attachmentIds` entry.
   */
  createAttachment(request: CreateAttachmentRequest): Promise<unknown> {
    return this.post('/comment/attachment/', request)
  }

  /**
   * Publishes a Note to the authenticated account's feed.
   * This operation has an irreversible external side effect.
   */
  publishNote(request: PublishNoteRequest): Promise<unknown> {
    return this.post('/comment/feed/', request)
  }

  getActivity(filter: ActivityFilter = 'all'): Promise<ActivityFeed> {
    return this.global(`/activity-feed-web?filter=${encodeURIComponent(filter)}`)
  }

  async getUnreadActivity(): Promise<UnreadActivityFeed> {
    const [unread, feed] = await Promise.all([
      this.global<{ count?: unknown; max?: unknown; lastViewedAt?: unknown }>('/activity/unread'),
      this.getActivity('all')
    ])
    const unreadCount =
      typeof unread.count === 'number' && Number.isFinite(unread.count)
        ? Math.max(0, Math.floor(unread.count))
        : 0

    return {
      ...feed,
      activityItems: Array.isArray(feed.activityItems)
        ? feed.activityItems.slice(0, unreadCount)
        : [],
      unread: {
        count: unreadCount,
        max: unread.max,
        lastViewedAt: unread.lastViewedAt,
        strategy: 'latest-activity-items'
      }
    }
  }

  async getFollowing(): Promise<unknown> {
    const settings = await this.put<{ user_id?: unknown }>('/user-setting', {
      type: 'last_home_tab',
      value_text: 'inbox'
    })
    const userId = positiveInteger(Number(settings.user_id), 'Authenticated user ID')
    return this.publication(`/user/${userId}/subscriber-lists?lists=following`)
  }

  async testConnectivity(): Promise<boolean> {
    try {
      await this.put('/user-setting', { type: 'last_home_tab', value_text: 'inbox' })
      return true
    } catch {
      return false
    }
  }

  private global<T = unknown>(path: string): Promise<T> {
    return this.request<T>(this.globalApiBase, path)
  }

  private publication<T = unknown>(path: string): Promise<T> {
    if (!this.publicationApiBase) {
      throw new SubstackConfigurationError(
        'A Substack publication URL is required for publication-scoped routes.'
      )
    }
    return this.request<T>(this.publicationApiBase, path)
  }

  private put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(this.globalApiBase, path, {
      method: 'PUT',
      body: JSON.stringify(body)
    })
  }

  private post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(this.globalApiBase, path, {
      method: 'POST',
      body: JSON.stringify(body)
    })
  }

  private async request<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(path.replace(/^\/+/, ''), baseUrl).toString()
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    headers.set('cookie', this.sessionCookie)
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }

    // Do not store native fetch as an instance method: platform fetch
    // implementations require their global receiver.
    const response = this.fetchImpl
      ? await this.fetchImpl(url, { ...init, headers })
      : await globalThis.fetch(url, { ...init, headers })
    const body = await response.text()

    if (!response.ok) {
      throw new SubstackApiError(
        `Substack request failed with ${response.status}.`,
        response.status,
        url,
        body.slice(0, 500)
      )
    }

    if (!body) {
      return undefined as T
    }

    try {
      return JSON.parse(body) as T
    } catch {
      throw new SubstackApiError('Substack returned a non-JSON response.', 502, url, body.slice(0, 500))
    }
  }
}

export { isActivityFilter }
