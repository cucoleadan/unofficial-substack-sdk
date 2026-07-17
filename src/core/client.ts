import { SubstackApiError, SubstackConfigurationError } from './errors.js'
import type { EndpointContext } from './transport.js'
import type {
  ActivityFeed,
  ActivityFilter,
  CreateAttachmentRequest,
  CursorOptions,
  DraftNotesOptions,
  DraftNotesPage,
  EmailStatsOptions,
  EmailStatsPage,
  FetchLike,
  PostWithEngagement,
  PostWithEngagementOptions,
  PublishNoteRequest,
  ProfilePostsOptions,
  ScheduleNoteRequest,
  SubstackClientOptions,
  SubscriberStatsResponse,
  UnreadActivityFeed,
  UploadedImage,
  UpdateScheduledNoteRequest
} from './types.js'
import { getActivity, getUnreadActivity } from '../resources/activity/index.js'
import { getAllEmailStats, getEmailStats } from '../resources/email-stats/index.js'
import {
  createAttachment,
  createImageAttachment,
  deleteNote,
  getComment,
  getDraftNotes,
  getNote,
  getNotes,
  getPostComments,
  getProfileNotes,
  publishNote,
  scheduleNote,
  uploadImage,
  updateScheduledNote
} from '../resources/notes/index.js'
import { getPost, getPostWithEngagement } from '../resources/posts/index.js'
import {
  getAuthenticatedProfile,
  getFollowing,
  getProfileById,
  getProfilePosts,
  getPublicProfile
} from '../resources/profiles/index.js'
import { getSubscriberStats } from '../resources/subscriber-stats/index.js'

const DEFAULT_BASE_URL = 'https://substack.com'
const DEFAULT_SESSION_COOKIE_NAME = 'substack.sid'
const DEFAULT_API_PREFIX = 'api/v1'

function normalizeOrigin(value: string): URL {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new SubstackConfigurationError('A Substack base URL cannot be empty.')
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    try {
      url = new URL(`https://${trimmed}`)
    } catch {
      throw new SubstackConfigurationError('A valid Substack HTTPS URL is required.')
    }
  }

  if (url.protocol !== 'https:') {
    throw new SubstackConfigurationError('A Substack API URL must use HTTPS.')
  }

  return url
}

/**
 * Normalizes an HTTPS Substack or custom-publication origin into an API base.
 * Query strings and fragments from copied browser URLs are intentionally
 * discarded. The caller is responsible for trusting custom origins because the
 * session cookie is sent to the configured publication URL.
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
  private readonly endpoints: EndpointContext

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
    this.endpoints = {
      global: <T = unknown>(path: string) => this.global<T>(path),
      publication: <T = unknown>(path: string) => this.publication<T>(path),
      post: <T = unknown>(path: string, body: unknown) => this.post<T>(path, body),
      patch: <T = unknown>(path: string, body: unknown) => this.patch<T>(path, body),
      put: <T = unknown>(path: string, body: unknown) => this.put<T>(path, body),
      remove: <T = unknown>(path: string) => this.remove<T>(path)
    }
  }

  getAuthenticatedProfile(): Promise<unknown> {
    return getAuthenticatedProfile(this.endpoints)
  }

  getPublicProfile(handle: string): Promise<unknown> {
    return getPublicProfile(this.endpoints, handle)
  }

  getProfileById(id: number | string): Promise<unknown> {
    return getProfileById(this.endpoints, id)
  }

  getPost(id: string | number): Promise<unknown> {
    return getPost(this.endpoints, id)
  }

  /**
   * Returns a full post, its visible comment tree, and calculated engagement
   * totals. A publication URL is required to retrieve post comments.
   */
  getPostWithEngagement(
    id: string | number,
    options: PostWithEngagementOptions = {}
  ): Promise<PostWithEngagement> {
    this.requirePublicationApiBase()
    return getPostWithEngagement(this.endpoints, id, options)
  }

  getProfilePosts(id: number | string, options: ProfilePostsOptions = {}): Promise<unknown> {
    return getProfilePosts(this.endpoints, id, options)
  }

  getNotes(options: CursorOptions = {}): Promise<unknown> {
    return getNotes(this.endpoints, options)
  }

  /** Returns scheduled Note drafts for the authenticated account. */
  getDraftNotes<T = unknown>(options: DraftNotesOptions = {}): Promise<DraftNotesPage<T>> {
    return getDraftNotes<T>(this.endpoints, options)
  }

  getProfileNotes(id: number | string, options: CursorOptions = {}): Promise<unknown> {
    return getProfileNotes(this.endpoints, id, options)
  }

  getNote(id: number | string): Promise<unknown> {
    return getNote(this.endpoints, id)
  }

  getComment(id: number | string): Promise<unknown> {
    return getComment(this.endpoints, id)
  }

  /**
   * Permanently deletes a Note or Note draft owned by the authenticated account.
   * This operation has an irreversible external side effect.
   */
  deleteNote(id: number | string): Promise<unknown> {
    return deleteNote(this.endpoints, id)
  }

  getPostComments(id: number | string): Promise<unknown> {
    return getPostComments(this.endpoints, id)
  }

  /**
   * Returns email delivery and engagement statistics for this publication's posts.
   * The response is available only to authenticated publication administrators.
   */
  getEmailStats<T = unknown>(options: EmailStatsOptions = {}): Promise<EmailStatsPage<T>> {
    return getEmailStats(this.endpoints, options)
  }

  /**
   * Retrieves every available email-stat row, starting at `options.offset`.
   * It continues until Substack returns an empty page and returns a flat array
   * of rows. Use `options.limit` to control the number requested per page.
   */
  getAllEmailStats<T = unknown>(options: EmailStatsOptions = {}): Promise<T[]> {
    return getAllEmailStats(this.endpoints, options)
  }

  /**
   * Returns the publication's subscriber records and aggregate subscriber count.
   * The response may include subscriber personal data, including email addresses.
   */
  getSubscriberStats<T = unknown>(): Promise<SubscriberStatsResponse<T>> {
    return getSubscriberStats(this.endpoints)
  }

  /**
   * Creates a link attachment for a Note. Pass the returned attachment ID to
   * `publishNote` as an `attachmentIds` entry.
   */
  createAttachment(request: CreateAttachmentRequest): Promise<unknown> {
    return createAttachment(this.endpoints, request)
  }

  /** Uploads a data-URL image and returns its Substack media metadata. */
  uploadImage(image: string): Promise<UploadedImage> {
    return uploadImage(this.endpoints, image)
  }

  /** Creates a Note image attachment from a previously uploaded image. */
  createImageAttachment(image: UploadedImage): Promise<unknown> {
    return createImageAttachment(this.endpoints, image)
  }

  /**
   * Publishes a Note to the authenticated account's feed.
   * This operation has an irreversible external side effect.
   */
  publishNote(request: PublishNoteRequest): Promise<unknown> {
    return publishNote(this.endpoints, request)
  }

  /**
   * Creates a scheduled Note draft that Substack will publish at triggerAt.
   * This operation creates server-side content but does not publish immediately.
   */
  scheduleNote(request: ScheduleNoteRequest): Promise<unknown> {
    return scheduleNote(this.endpoints, request)
  }

  /** Updates a scheduled Note draft and its scheduled publication time. */
  updateScheduledNote(id: number | string, request: UpdateScheduledNoteRequest): Promise<unknown> {
    return updateScheduledNote(this.endpoints, id, request)
  }

  getActivity(filter: ActivityFilter = 'all'): Promise<ActivityFeed> {
    return getActivity(this.endpoints, filter)
  }

  getUnreadActivity(): Promise<UnreadActivityFeed> {
    return getUnreadActivity(this.endpoints)
  }

  getFollowing(): Promise<unknown> {
    return getFollowing(this.endpoints)
  }

  async testConnectivity(): Promise<boolean> {
    try {
      await this.endpoints.put('/user-setting', { type: 'last_home_tab', value_text: 'inbox' })
      return true
    } catch {
      return false
    }
  }

  private global<T = unknown>(path: string): Promise<T> {
    return this.request<T>(this.globalApiBase, path)
  }

  private publication<T = unknown>(path: string): Promise<T> {
    return this.request<T>(this.requirePublicationApiBase(), path)
  }

  private requirePublicationApiBase(): string {
    if (!this.publicationApiBase) {
      throw new SubstackConfigurationError(
        'A Substack publication URL is required for publication-scoped routes.'
      )
    }
    return this.publicationApiBase
  }

  private put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(this.globalApiBase, path, {
      method: 'PUT',
      body: JSON.stringify(body)
    })
  }

  private patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(this.globalApiBase, path, {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
  }

  private remove<T = unknown>(path: string): Promise<T> {
    return this.request<T>(this.globalApiBase, path, { method: 'DELETE' })
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
      ? await this.fetchImpl(url, { ...init, headers, redirect: 'error' })
      : await globalThis.fetch(url, { ...init, headers, redirect: 'error' })
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

export { isActivityFilter } from '../resources/activity/index.js'
