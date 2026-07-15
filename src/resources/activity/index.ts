import type { EndpointContext } from '../../core/transport.js'
import { ACTIVITY_FILTERS, type ActivityFeed, type ActivityFilter, type UnreadActivityFeed } from '../../core/types.js'

export function isActivityFilter(value: string): value is ActivityFilter {
  return (ACTIVITY_FILTERS as readonly string[]).includes(value)
}

export function getActivity(context: EndpointContext, filter: ActivityFilter = 'all'): Promise<ActivityFeed> {
  return context.global(`/activity-feed-web?filter=${encodeURIComponent(filter)}`)
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
