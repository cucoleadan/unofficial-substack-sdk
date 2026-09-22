import { SubstackApiError, SubstackConfigurationError } from '../../core/errors.js'
import type { EndpointContext } from '../../core/transport.js'
import { positiveInteger } from '../../core/validation.js'
import type {
  FollowingOptions,
  ProfileFeedFilter,
  ProfileFeedOptions,
  ProfileFeedPage,
  ProfilePostsOptions,
  ProfileRepliesOptions,
  SubscriptionsOptions
} from '../../core/types.js'

type ProfileFeedItem = {
  context?: {
    users?: Array<{ id?: number | string; handle?: string }>
  }
}

export async function getAuthenticatedProfile(context: EndpointContext): Promise<unknown> {
  const handles = await context.global<{ potentialHandles?: Array<{ handle: string; type: string }> }>(
    '/handle/options'
  )
  const ownHandle = handles.potentialHandles?.find((handle) => handle.type === 'existing')?.handle

  if (!ownHandle) {
    throw new SubstackApiError('Authenticated Substack profile was not found.', 502, '/handle/options')
  }

  return getPublicProfile(context, ownHandle)
}

export function getPublicProfile(context: EndpointContext, handle: string): Promise<unknown> {
  const normalizedHandle = handle.trim()
  if (!normalizedHandle) {
    throw new SubstackConfigurationError('A profile handle is required.')
  }
  return context.global(`/user/${encodeURIComponent(normalizedHandle)}/public_profile`)
}

export async function getProfileById(context: EndpointContext, id: number | string): Promise<unknown> {
  const profileId = positiveInteger(id, 'Profile ID')
  const feed = await context.global<{ items?: ProfileFeedItem[] }>(`/reader/feed/profile/${profileId}`)
  const user = feed.items
    ?.flatMap((item) => item.context?.users ?? [])
    .find((candidate) => Number(candidate.id) === profileId && typeof candidate.handle === 'string')

  if (!user?.handle) {
    throw new SubstackApiError(`Profile with ID ${profileId} was not found.`, 404, `/reader/feed/profile/${profileId}`)
  }

  return getPublicProfile(context, user.handle)
}

function profileFeedFilter(value: ProfileFeedFilter): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SubstackConfigurationError('Profile feed filters must be non-empty strings.')
  }
  return value
}

/** Returns one raw page from a profile's authenticated, mixed reader feed. */
export function getProfileFeed(
  context: EndpointContext,
  id: number | string,
  options: ProfileFeedOptions = {}
): Promise<ProfileFeedPage> {
  const profileId = positiveInteger(id, 'Profile ID')
  const query = new URLSearchParams()

  if (options.limit !== undefined) {
    query.set('limit', String(positiveInteger(options.limit, 'Profile feed limit')))
  }
  if (options.cursor) {
    query.set('cursor', options.cursor)
  }
  for (const type of options.types ?? []) {
    query.append('types[]', profileFeedFilter(type))
  }

  const search = query.size ? `?${query.toString()}` : ''
  return context.global(`/reader/feed/profile/${profileId}${search}`)
}

/** Returns one raw page of comments and replies authored by a profile. */
export function getProfileReplies(
  context: EndpointContext,
  id: number | string,
  options: ProfileRepliesOptions = {}
): Promise<ProfileFeedPage> {
  return getProfileFeed(context, id, { ...options, types: ['replies'] })
}

export function getProfilePosts(
  context: EndpointContext,
  id: number | string,
  _options: ProfilePostsOptions = {}
): Promise<unknown> {
  const profileId = positiveInteger(id, 'Profile ID')
  return context.global(`/profile/posts?profile_user_id=${profileId}`)
}

export async function getFollowing(
  context: EndpointContext,
  options: FollowingOptions = {}
): Promise<unknown> {
  let profileId = options.profileId
  if (!profileId) {
    const profile = (await getAuthenticatedProfile(context)) as { id?: number | string }
    if (!profile?.id) {
      throw new SubstackApiError('Authenticated Substack profile ID was not found.', 502, '/handle/options')
    }
    profileId = profile.id
  }
  const userId = positiveInteger(profileId, 'Profile ID')
  return context.publication(`/user/${userId}/subscriber-lists?lists=following`)
}

export async function getSubscriptions(
  context: EndpointContext,
  options: SubscriptionsOptions = {}
): Promise<unknown> {
  if (options.handle) {
    const profile = (await getPublicProfile(context, options.handle)) as Record<string, unknown>
    return profile?.subscriptions ?? []
  }
  if (options.profileId) {
    const profile = (await getProfileById(context, options.profileId)) as Record<string, unknown>
    return profile?.subscriptions ?? []
  }
  return context.global('/subscriptions')
}
