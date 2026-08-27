import type { EndpointContext } from '../../core/transport.js'
import type { SubscriberStatsResponse, EmailStatsItem } from '../../core/types.js'

export async function getSubscriberStats<T = unknown>(
  context: EndpointContext
): Promise<SubscriberStatsResponse<T> | Record<string, unknown>> {
  try {
    // 1. Try legacy/native endpoint
    return await context.publication<SubscriberStatsResponse<T>>('/subscriber-stats')
  } catch (error: any) {
    // 2. If Substack returns 404 (endpoint deprecated), fall back to email-stats
    if (error?.status === 404 || error?.message?.includes('404')) {
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
      return {
        derived_from_delivery: true,
        active_subscribers_delivered: latest?.delivered ?? latest?.queued ?? 0,
        recent_signups: latest?.signups ?? 0,
        latest_post_title: latest?.title ?? '',
        open_rate: latest?.open_rate ? `${(latest.open_rate * 100).toFixed(1)}%` : '0%'
      }
    }
    throw error
  }
}
