import type { EndpointContext } from '../../core/transport.js'
import type {
  SubscriberStatsResponse,
  PaidSubscribersBreakdown,
  EmailStatsItem
} from '../../core/types.js'

export async function getSubscriberStats<T = unknown>(
  context: EndpointContext
): Promise<SubscriberStatsResponse<T> | Record<string, unknown>> {
  // 1. Try modern publication stats and dashboard summary endpoints
  try {
    const statsPromise = context.publication<Record<string, unknown>>('/publication/stats/subscribers')
    const summaryPromise = context
      .publication<Record<string, unknown>>('/publish-dashboard/summary')
      .catch(() => undefined)

    const [stats, summary] = await Promise.all([statsPromise, summaryPromise])

    const totalEmail =
      typeof stats?.totalEmail === 'number'
        ? stats.totalEmail
        : typeof summary?.totalEmail === 'number'
          ? summary.totalEmail
          : undefined

    const paidSubs =
      typeof stats?.subscribers === 'number'
        ? stats.subscribers
        : typeof summary?.subscribers === 'number'
          ? summary.subscribers
          : undefined

    const appSubs =
      typeof summary?.appSubscribers === 'number'
        ? summary.appSubscribers
        : undefined

    const total = totalEmail ?? 0
    const paid = paidSubs ?? 0
    const free = Math.max(0, total - paid)

    return {
      ...(totalEmail !== undefined ? { total_subscribers: total } : {}),
      ...(paidSubs !== undefined ? { paid_subscribers: paid } : {}),
      ...(totalEmail !== undefined || paidSubs !== undefined ? { free_subscribers: free } : {}),
      ...(appSubs !== undefined ? { app_subscribers: appSubs } : {}),
      ...(typeof stats?.comp_subscribers === 'number' ? { comp_subscribers: stats.comp_subscribers } : {}),
      ...(typeof stats?.gift_subscribers === 'number' ? { gift_subscribers: stats.gift_subscribers } : {}),
      ...(typeof stats?.free_trial_subscribers === 'number'
        ? { free_trial_subscribers: stats.free_trial_subscribers }
        : {}),
      ...(typeof stats?.founding_subscribers === 'number'
        ? { founding_subscribers: stats.founding_subscribers }
        : {}),
      ...(typeof stats?.lifetime_subscribers === 'number'
        ? { lifetime_subscribers: stats.lifetime_subscribers }
        : {}),
      ...(typeof summary?.totalEmailLast30Days === 'number'
        ? { total_email_last_30_days: summary.totalEmailLast30Days }
        : {}),
      ...(typeof summary?.appSubscribersLast30Days === 'number'
        ? { app_subscribers_last_30_days: summary.appSubscribersLast30Days }
        : {}),
      ...(typeof summary?.views === 'number' ? { views: summary.views } : {}),
      ...(typeof summary?.openRate === 'number'
        ? { open_rate: `${summary.openRate.toFixed(1)}%` }
        : {}),
      ...(typeof summary?.numPledges === 'number' ? { num_pledges: summary.numPledges } : {}),
      ...(typeof summary?.pledgesAmount === 'number'
        ? { pledges_amount: summary.pledgesAmount }
        : {}),
      ...(typeof summary?.pledgeCurrency === 'string'
        ? { pledge_currency: summary.pledgeCurrency }
        : {}),
      ...(stats ?? {})
    }
  } catch (error: any) {
    if (
      error?.status !== 404 &&
      !error?.message?.includes('404') &&
      error?.status !== 403 &&
      !error?.message?.includes('403')
    ) {
      throw error
    }
  }

  // 2. Try legacy /subscriber-stats endpoint
  try {
    return await context.publication<SubscriberStatsResponse<T>>('/subscriber-stats')
  } catch (error: any) {
    if (error?.status !== 404 && !error?.message?.includes('404')) {
      throw error
    }

    // 3. Fall back to email-stats
    let emailStats: any
    try {
      emailStats = await context.publication<EmailStatsItem[]>('/email-stats')
    } catch (err: any) {
      if (err?.status === 404 || err?.message?.includes('404')) {
        const res = await context.publication<{ rows?: EmailStatsItem[] }>(
          '/publication/stats/email_stats?offset=0&limit=20'
        )
        emailStats = res?.rows ?? []
      } else {
        throw err
      }
    }
    const latest = Array.isArray(emailStats) && emailStats.length > 0 ? emailStats[0] : null
    const delivered = latest?.delivered ?? latest?.queued ?? 0
    return {
      derived_from_delivery: true,
      total_subscribers: delivered,
      active_subscribers_delivered: delivered,
      recent_signups: latest?.signups ?? 0,
      latest_post_title: latest?.title ?? '',
      open_rate: latest?.open_rate ? `${(latest.open_rate * 100).toFixed(1)}%` : '0%'
    }
  }
}

/** Returns a structured breakdown of paid and free subscribers, tiers, and pledges. */
export async function getPaidSubscribers(
  context: EndpointContext
): Promise<PaidSubscribersBreakdown | Record<string, unknown>> {
  const stats = (await getSubscriberStats(context)) as Record<string, unknown>
  const total =
    typeof stats.total_subscribers === 'number'
      ? stats.total_subscribers
      : typeof stats.totalEmail === 'number'
        ? stats.totalEmail
        : typeof stats.total === 'number'
          ? stats.total
          : 0
  const paid =
    typeof stats.paid_subscribers === 'number'
      ? stats.paid_subscribers
      : typeof stats.subscribers === 'number'
        ? stats.subscribers
        : 0
  const free =
    typeof stats.free_subscribers === 'number'
      ? stats.free_subscribers
      : Math.max(0, total - paid)

  return {
    total_subscribers: total,
    paid_subscribers: paid,
    free_subscribers: free,
    ...(typeof stats.app_subscribers === 'number' ? { app_subscribers: stats.app_subscribers } : {}),
    ...(typeof stats.comp_subscribers === 'number' ? { comp_subscribers: stats.comp_subscribers } : {}),
    ...(typeof stats.gift_subscribers === 'number' ? { gift_subscribers: stats.gift_subscribers } : {}),
    ...(typeof stats.free_trial_subscribers === 'number'
      ? { free_trial_subscribers: stats.free_trial_subscribers }
      : {}),
    ...(typeof stats.founding_subscribers === 'number'
      ? { founding_subscribers: stats.founding_subscribers }
      : {}),
    ...(typeof stats.lifetime_subscribers === 'number'
      ? { lifetime_subscribers: stats.lifetime_subscribers }
      : {}),
    ...(typeof stats.pledges_amount === 'number' ? { pledges_amount: stats.pledges_amount } : {}),
    ...(typeof stats.num_pledges === 'number' ? { num_pledges: stats.num_pledges } : {}),
    ...(typeof stats.pledge_currency === 'string' ? { pledge_currency: stats.pledge_currency } : {})
  }
}
