import type { EndpointContext } from '../../core/transport.js'
import { SubstackApiError, SubstackConfigurationError } from '../../core/errors.js'
import { ACTIVITY_FILTERS, type ActivityFeed, type ActivityFilter, type ActivityPage, type ActivityPageOptions, type UnreadActivityFeed } from '../../core/types.js'

export function isActivityFilter(value: string): value is ActivityFilter {
  return (ACTIVITY_FILTERS as readonly string[]).includes(value)
}

export function getActivity(context: EndpointContext, filter: ActivityFilter = 'all'): Promise<ActivityFeed> {
  return context.global(`/activity-feed-web?filter=${encodeURIComponent(filter)}`)
}

// Date.parse alone accepts normalized invalid dates and non-ISO date strings.
function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return null
  const local = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`
  const localTime = Date.parse(local)
  if (!Number.isFinite(localTime) || new Date(localTime).toISOString() !== local) return null
  if (match[3] !== 'Z' && (Number(match[3]!.slice(1, 3)) > 23 || Number(match[3]!.slice(4)) > 59)) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

export async function getActivityPage(
  context: EndpointContext,
  options: ActivityPageOptions = {}
): Promise<ActivityPage> {
  const filter = options.filter ?? 'all'
  if (typeof filter !== 'string' || !isActivityFilter(filter)) {
    throw new SubstackConfigurationError('Invalid activity filter.')
  }
  const afterTime = options.after === undefined ? null : timestamp(options.after)
  if (options.after !== undefined && afterTime === null) {
    throw new SubstackConfigurationError('after must be a valid ISO 8601 timestamp with a timezone and at most millisecond precision.')
  }
  const path = `/activity-feed-web?filter=${encodeURIComponent(filter)}` +
    (options.after === undefined ? '' : `&after=${encodeURIComponent(options.after)}`)
  const response = await context.global<unknown>(path)
  const invalid = (message: string): never => {
    throw new SubstackApiError(`Invalid activity pagination: ${message}`, 502, path)
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    invalid('expected an object response.')
  }
  const page = response as Record<string, unknown>
  if (!Array.isArray(page.activityItems) || typeof page.more !== 'boolean') {
    invalid('activityItems must be an array and more must be a boolean.')
  }
  const items = page.activityItems as unknown[]
  if (page.more && items.length === 0) invalid('an empty page cannot have more=true.')
  let previous = Infinity
  for (const item of items) {
    const time = timestamp(item && typeof item === 'object' && !Array.isArray(item)
      ? (item as Record<string, unknown>).updated_at : undefined)
    if (time === null) return invalid('each item must have a valid updated_at timestamp.')
    if (time > previous) invalid('updated_at values must be in descending order (ties allowed).')
    if (afterTime !== null && time > afterTime) invalid('items must not be newer than the supplied after cursor.')
    previous = time
  }
  const nextTime = previous - 1
  if (items.length && afterTime !== null && previous >= afterTime) {
    invalid('the page must advance beyond the supplied after cursor.')
  }
  const nextAfter = page.more ? new Date(nextTime).toISOString() : null
  if (nextAfter !== null && timestamp(nextAfter) === null) {
    invalid('the next cursor is outside the supported timestamp range.')
  }
  return { ...page, activityItems: items, more: page.more, nextAfter } as ActivityPage
}

export async function getUnreadActivity(context: EndpointContext): Promise<UnreadActivityFeed> {
  const [unread, feed] = await Promise.all([
    context.global<{ count?: unknown; max?: unknown; lastViewedAt?: unknown }>('/activity/unread'),
    getActivity(context, 'all')
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
