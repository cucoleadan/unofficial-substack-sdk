import { SubstackApiError } from '../../core/errors.js'
import type { EndpointContext } from '../../core/transport.js'
import { nonNegativeInteger } from '../../core/validation.js'
import type { EmailStatsOptions, EmailStatsPage, EmailStatsRow } from '../../core/types.js'

const EMAIL_STATS_LIMIT = 20

function emailStatsQuery(options: EmailStatsOptions): URLSearchParams {
  return new URLSearchParams({
    offset: String(nonNegativeInteger(options.offset ?? 0, 'Email stats offset')),
    limit: String(EMAIL_STATS_LIMIT),
    order_by: options.orderBy ?? 'post_date',
    order_direction: options.orderDirection ?? 'desc'
  })
}

/** Returns email delivery and engagement statistics for a publication's posts. */
export function getEmailStats<T = EmailStatsRow>(
  context: EndpointContext,
  options: EmailStatsOptions = {}
): Promise<EmailStatsPage<T>> {
  return context.publication(`/publication/stats/email_stats?${emailStatsQuery(options).toString()}`)
}

/** Retrieves every available email-stat row, starting at `options.offset`. */
export async function getAllEmailStats<T = EmailStatsRow>(
  context: EndpointContext,
  options: EmailStatsOptions = {}
): Promise<T[]> {
  const rows: T[] = []
  let offset = nonNegativeInteger(options.offset ?? 0, 'Email stats offset')

  while (true) {
    const page = await getEmailStats<T>(context, { ...options, offset })
    if (!Array.isArray(page.rows)) {
      throw new SubstackApiError(
        'Substack returned an email stats response without a rows array.',
        502,
        '/publication/stats/email_stats'
      )
    }

    rows.push(...page.rows)
    if (page.rows.length === 0) {
      return rows
    }

    offset += page.rows.length
  }
}
