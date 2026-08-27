import type { EndpointContext } from '../../core/transport.js'
import type { GrowthSourcesOptions, GrowthSourcesResponse, GrowthSourceItem } from '../../core/types.js'

function growthSourcesQuery(options: GrowthSourcesOptions): URLSearchParams {
  const params = new URLSearchParams()
  params.set('order_by', options.orderBy ?? 'users')
  params.set('order_direction', options.orderDirection ?? 'desc')
  if (options.fromDate) params.set('from_date', options.fromDate)
  if (options.toDate) params.set('to_date', options.toDate)
  return params
}

/**
 * Returns historical breakdown of traffic, subscriber growth, and revenue by acquisition source.
 */
export function getGrowthSources<TSource = GrowthSourceItem>(
  context: EndpointContext,
  options: GrowthSourcesOptions = {}
): Promise<GrowthSourcesResponse<TSource>> {
  const query = growthSourcesQuery(options).toString()
  return context.publication(`/publication/stats/growth/sources${query ? `?${query}` : ''}`)
}
