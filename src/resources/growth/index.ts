import type { EndpointContext } from '../../core/transport.js'
import type { GrowthSourcesOptions, GrowthSourcesResponse, GrowthSourceItem } from '../../core/types.js'

function growthSourcesQuery(options: GrowthSourcesOptions): URLSearchParams {
  const params = new URLSearchParams()
  const orderBy = options.orderBy ?? options.order_by ?? 'users'
  const orderDirection = options.orderDirection ?? options.order_direction ?? 'desc'
  const fromDate = options.fromDate ?? options.from_date
  const toDate = options.toDate ?? options.to_date

  params.set('order_by', orderBy)
  params.set('order_direction', orderDirection)
  if (fromDate) params.set('from_date', fromDate)
  if (toDate) params.set('to_date', toDate)
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
