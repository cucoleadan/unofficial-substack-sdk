import { SubstackApiError, SubstackConfigurationError } from '../../core/errors.js'
import type { EndpointContext } from '../../core/transport.js'
import { positiveInteger } from '../../core/validation.js'
import type { ProfilePostsOptions } from '../../core/types.js'

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

export function getProfilePosts(
  context: EndpointContext,
  id: number | string,
  _options: ProfilePostsOptions = {}
): Promise<unknown> {
  const profileId = positiveInteger(id, 'Profile ID')
  return context.global(`/profile/posts?profile_user_id=${profileId}`)
}

export async function getFollowing(context: EndpointContext): Promise<unknown> {
  const settings = await context.put<{ user_id?: unknown }>('/user-setting', {
    type: 'last_home_tab',
    value_text: 'inbox'
  })
  const userId = positiveInteger(Number(settings.user_id), 'Authenticated user ID')
  return context.publication(`/user/${userId}/subscriber-lists?lists=following`)
}
