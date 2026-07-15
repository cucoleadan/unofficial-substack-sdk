import type { EndpointContext } from '../../core/transport.js'
import type { SubscriberStatsResponse } from '../../core/types.js'

/**
 * Returns the publication's subscriber records and aggregate subscriber count.
 * The response can contain subscriber personal data, including email addresses.
 */
export function getSubscriberStats<T = unknown>(
  context: EndpointContext
): Promise<SubscriberStatsResponse<T>> {
  return context.publication('/subscriber-stats')
}
