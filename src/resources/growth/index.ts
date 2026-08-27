import { SubstackConfigurationError } from '../../core/errors.js'
import type { EndpointContext } from '../../core/transport.js'
import type {
  GrowthInterval,
  GrowthSourcesOptions,
  GrowthSourcesResponse,
  GrowthSourceItem,
  GrowthTotalItem
} from '../../core/types.js'

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

function parseDate(d: string): Date {
  const parts = d.split('-').map(Number)
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function generateDateWindows(
  fromDate: string,
  toDate: string,
  granularity: 'day' | 'week' | 'month'
): Array<{ fromDate: string; toDate: string }> {
  const start = parseDate(fromDate)
  const end = parseDate(toDate)
  const windows: Array<{ fromDate: string; toDate: string }> = []

  let current = new Date(start)

  while (current <= end) {
    const windowStart = new Date(current)
    let windowEnd: Date

    if (granularity === 'day') {
      windowEnd = new Date(current)
      current.setUTCDate(current.getUTCDate() + 1)
    } else if (granularity === 'week') {
      windowEnd = new Date(current)
      windowEnd.setUTCDate(windowEnd.getUTCDate() + 6)
      if (windowEnd > end) windowEnd = new Date(end)
      current.setUTCDate(current.getUTCDate() + 7)
    } else {
      // month
      windowEnd = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0))
      if (windowEnd > end) windowEnd = new Date(end)
      current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1))
    }

    windows.push({
      fromDate: formatDate(windowStart),
      toDate: formatDate(windowEnd)
    })
  }

  return windows
}

/**
 * Returns historical breakdown of traffic, subscriber growth, and revenue by acquisition source.
 * When `granularity` ('day' | 'week' | 'month') is specified with a date range, interval slices
 * are fetched with strict rate-limiting (max 2 requests/second).
 */
export async function getGrowthSources<TSource = GrowthSourceItem>(
  context: EndpointContext,
  options: GrowthSourcesOptions = {}
): Promise<GrowthSourcesResponse<TSource>> {
  const granularity = options.granularity ?? 'total'
  const fromDate = options.fromDate ?? options.from_date
  const toDate = options.toDate ?? options.to_date

  if (fromDate && toDate && fromDate > toDate) {
    throw new SubstackConfigurationError('Growth sources fromDate cannot be after toDate.')
  }

  if (granularity === 'total' || !fromDate || !toDate) {
    const query = growthSourcesQuery(options).toString()
    const res = await context.publication<GrowthSourcesResponse<TSource>>(
      `/publication/stats/growth/sources${query ? `?${query}` : ''}`
    )
    return {
      ...res,
      granularity: 'total'
    }
  }

  const windows = generateDateWindows(fromDate, toDate, granularity)

  if (granularity === 'day' && windows.length > 31) {
    throw new SubstackConfigurationError(
      'Daily granularity is limited to a maximum range of 31 days. Use weekly or monthly granularity for larger date ranges.'
    )
  }
  if (granularity === 'week' && windows.length > 26) {
    throw new SubstackConfigurationError(
      'Weekly granularity is limited to a maximum range of 26 weeks. Use monthly granularity for larger date ranges.'
    )
  }
  if (granularity === 'month' && windows.length > 24) {
    throw new SubstackConfigurationError(
      'Monthly granularity is limited to a maximum range of 24 months.'
    )
  }

  const intervals: GrowthInterval<TSource, GrowthTotalItem>[] = []
  let totalTraffic = 0
  let totalSubscribers = 0
  let totalRevenue = 0
  let lastCallTime = 0

  for (const w of windows) {
    const now = Date.now()
    const elapsed = now - lastCallTime
    if (lastCallTime > 0 && elapsed < 500) {
      await new Promise((resolve) => setTimeout(resolve, 500 - elapsed))
    }
    lastCallTime = Date.now()

    const windowOptions: GrowthSourcesOptions = {
      ...options,
      fromDate: w.fromDate,
      toDate: w.toDate
    }
    const query = growthSourcesQuery(windowOptions).toString()
    const page = await context.publication<GrowthSourcesResponse<TSource>>(
      `/publication/stats/growth/sources${query ? `?${query}` : ''}`
    )

    const windowTraffic = page.totals?.find((t) => t.name === 'traffic')?.total ?? 0
    const windowSubs = page.totals?.find((t) => t.name === 'subscribers')?.total ?? 0
    const windowRev = page.totals?.find((t) => t.name === 'revenue')?.total ?? 0

    totalTraffic += windowTraffic ?? 0
    totalSubscribers += windowSubs ?? 0
    totalRevenue += windowRev ?? 0

    intervals.push({
      startDate: w.fromDate,
      endDate: w.toDate,
      totals: page.totals,
      sourceMetrics: page.sourceMetrics
    })
  }

  return {
    granularity,
    totals: [
      { name: 'traffic', total: totalTraffic },
      { name: 'subscribers', total: totalSubscribers },
      { name: 'revenue', total: totalRevenue }
    ],
    intervals
  }
}
