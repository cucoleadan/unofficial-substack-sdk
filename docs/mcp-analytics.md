# MCP analytics

The package's STDIO MCP server is read-only. It uses the same authenticated `SubstackClient` as the SDK and returns each successful result as both JSON text and structured content under `{ data }`.

Substack's web API is undocumented and can change without notice. Raw endpoint fields are retained where a tool returns them, while derived fields use explicit names and bounded payloads.

## Publication analytics

`get_publication_analytics` calls `getAllEmailStats()` and follows every fixed 20-row email-stat page. It can filter the collected rows by inclusive `from_date` and `to_date` values in `YYYY-MM-DD` format.

The result contains:

- `sourceRowsFetched`: rows collected from Substack before local date filtering.
- `filters`: the effective offset and optional date bounds.
- `rowsAnalyzed`: rows remaining after date filtering.
- `dateRange`: earliest and latest included raw `post_date` values.
- `totals`: sums of additive delivery, engagement, conversion, revenue, podcast, and video fields that were present.
- `averageRates`: arithmetic means of Substack's raw `open_rate`, `click_through_rate`, and `engagement_rate` values. These are not recalculated or weighted because Substack does not document every numerator's semantics.
- `breakdowns`: post counts grouped by audience, section, and content type.
- `topPosts`: a bounded ranking by the requested metric.
- `availableFields`: every raw field present in the included rows, including future fields unknown to the SDK.
- `rows`: optional raw rows, capped by `row_limit` at 200.

Numeric strings are accepted when summing fields such as `podcast_preview_downloads`. Unknown numeric fields appear in `availableFields` but are not automatically summed because IDs, timestamps, rates, and counts cannot be distinguished safely without observed semantics.

Example MCP arguments:

```json
{
  "from_date": "2026-01-01",
  "to_date": "2026-06-30",
  "top_metric": "subscribes",
  "top_limit": 10,
  "include_rows": false
}
```

## Post analytics

`get_post_analytics` requests `getPostWithEngagement()` and `getPostManagementDetail()` concurrently. It returns:

- compact post identity and content metadata;
- every raw field under the matching management Post's `stats`, including link clicks, first-week daily stats, referrers, comparisons, and `data_updated_at` when Substack supplies them;
- normalized visible Post/comment engagement;
- management-reported reactions, comments, and replies;
- a bounded visible-comment sample;
- the full raw Post and management envelope only when `include_raw` is true.

`analyze_content` uses the same combined requests but omits comments and raw envelopes.

## Note analytics

`get_profile_notes` returns raw per-Note fields from a bounded profile feed page. `get_note_engagement` calls `getNoteWithEngagement()`, follows every reply cursor, and reports normalized reactions, restacks, direct replies, nested replies, total replies, viewer state, and `replyCountsComplete`.

Only the returned reply sample is capped. The normalized counts still represent every safely loaded page. `rawReplyPages` is excluded unless `include_raw_pages` is true. Note views remain absent unless a future Substack response includes a numeric `views` or `view_count` field.

## Subscriber privacy

`get_subscriber_summary` returns the upstream aggregate subscriber count when available, the number of records present in the response, numeric and boolean top-level aggregates, and available record field names without exposing record values. This is the default behavior.

Setting `include_records` to true returns up to `record_limit` raw subscriber records and sets `personalDataIncluded` to true. Those records can contain email addresses and other personal data. Use the option only in a trusted local MCP session and do not copy its results into logs, prompts, issues, or source control.

## Response limits

List-returning tools cap data returned to the model while retaining upstream pagination metadata when available. The caps reduce context size; they do not change Substack's fixed email-stat page size or the complete pagination needed for publication and Note summaries.
