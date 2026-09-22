# Unofficial Substack SDK

A small, portable TypeScript client for Substack's observed web API. It runs in Node.js 18+ and Bun using standard web APIs (`fetch`, `URL`, `Headers`, and `Response`).

> This is an unofficial community project. It is not affiliated with, endorsed by, or supported by Substack. The web API can change without notice.

## Install

```sh
npm install unofficial-substack-sdk
# or
bun add unofficial-substack-sdk
```

## Quick start

```ts
import { createNoteBodyJson, SubstackClient } from 'unofficial-substack-sdk'

const client = new SubstackClient({
  sessionToken: process.env.SUBSTACK_SESSION_TOKEN!,
  publicationUrl: 'https://your-publication.substack.com'
})

const profile = await client.getAuthenticatedProfile()
const activity = await client.getActivity('all')
const notes = await client.getNotes()
```

`sessionToken` is the value of the `substack.sid` cookie only: do not pass `substack.sid=` or a complete `Cookie` header. Store it only in trusted server-side environment variables—never expose it in browser code, client bundles, issues, or logs.

`publicationUrl` is required for publication-scoped methods such as `getNotes`, `getNote`, `getNoteWithEngagement`, `getComment`, `getPostComments`, `getPostManagementDetail`, `getEmailStats`, `getSubscriberStats`, `getProfileNotes`, and `getFollowing`. It accepts any HTTPS publication domain (including a custom domain) or a copied browser URL; query strings and fragments are discarded safely.

## Direct Substack requests only

This SDK has no Substack gateway dependency. Global API requests go directly to `https://substack.com` by default. Publication-scoped requests go directly to the `publicationUrl` you configure, including a custom domain.

Custom domains are supported, but they are a trust decision: the SDK sends the authenticated `substack.sid` cookie to the exact HTTPS origin in `publicationUrl`. Configure only a Substack publication domain you control or trust. Do not use a third-party, self-hosted, or closed-source Substack gateway, because it would receive that cookie. Redirects remain disabled so a configured origin cannot forward the cookie to another domain.

The optional `baseUrl` and legacy `substackUrl` overrides follow the same rule. Leave them unset for normal direct requests to `https://substack.com`; set either only when you intend to trust that HTTPS origin with the session cookie.

## Local configuration

Copy [`.dev.vars.example`](.dev.vars.example) to `.dev.vars` and replace the placeholders. The SDK does not load environment files itself; use your framework or local environment loader and pass the values into `SubstackClient`.

## MCP server

The package includes a read-only STDIO MCP server for publication, post, Note, subscriber, and activity analytics. It returns compact, normalized model-facing data by default, with explicit raw-data opt-ins where supported. Set `SUBSTACK_SESSION_TOKEN` and `SUBSTACK_PUBLICATION_URL`, then configure Codex:

```toml
[mcp_servers.substack]
command = "npx"
args = ["-y", "unofficial-substack-sdk"]

[mcp_servers.substack.env]
SUBSTACK_SESSION_TOKEN = "your-substack.sid-value"
SUBSTACK_PUBLICATION_URL = "https://your-publication.substack.com"
```

Keep the session token local and out of source control. All MCP tools are read-only and declare MCP read-only annotations.

| MCP tool | Description |
| --- | --- |
| `get_authenticated_profile` | Authenticated profile and the profile ID used by profile tools. |
| `get_recent_posts` | Bounded recent posts for a profile. |
| `get_email_stats` | One Substack email-stat page. Substack always fetches 20 rows; `limit` caps returned rows. |
| `get_publication_analytics` | Full-history totals, average upstream rates, audience/section/type breakdowns, top posts, and optional raw rows. |
| `get_post_engagement` | Post content engagement and a bounded visible-comment sample. |
| `get_post_analytics` | Combined author analytics, delivery, conversion, media, links, referrers, comparison data, and visible engagement. |
| `get_notes` | Compact, body-first Notes from the authenticated profile or optional `profile_id`; supports guarded `fetch_all`. |
| `get_profile_notes` | Compact, body-first profile Notes with cursor paging or guarded `fetch_all`. |
| `get_note_engagement` | Reactions, restacks, viewer state, and fully paginated direct/nested reply totals. |
| `get_subscriber_summary` | Privacy-safe subscriber totals. Raw records require explicit `include_records: true`. |
| `get_subscriber_stats` | Normalized publication subscriber statistics and tier breakdown. |
| `get_paid_subscribers` | Structured breakdown of paid vs free subscribers, subscription tiers (comp, gift, trial, founding), and pledges. |
| `get_activity` | Bounded activity filtered by all events, replies and mentions, or restacks. |
| `get_unread_activity` | Bounded unread activity plus unread metadata. |
| `get_growth_sources` | Historical publication traffic, subscriber acquisition, and revenue by referrer channel. |
| `get_following` | Accounts followed by the authenticated account or a specified profile ID. |
| `get_subscriptions` | Publication subscriptions for the authenticated account or public subscriptions for a handle/profile ID. |
| `analyze_content` | Compact complete analytics for one post without comment or raw-response payloads. |

`get_publication_analytics` follows every email-stat page before calculating its summary, so it can make several authenticated requests for a large archive. Raw rows are excluded by default and capped when requested. `get_notes` and `get_profile_notes` default to 10 complete Note bodies; set `fetch_all: true` to follow every cursor up to `max_items` (default 500, maximum 5,000). `get_subscriber_summary` excludes subscriber records by default because they can contain email addresses and other personal data. See [MCP analytics](docs/mcp-analytics.md) for output semantics and usage examples.

## API

| Method | Description |
| --- | --- |
| `getAuthenticatedProfile()` | Authenticated Substack profile. |
| `getPublicProfile(handle)` | Public profile by handle. |
| `getProfileById(id)` | Public profile by numeric user ID. |
| `getProfilePosts(id)` | Posts for a numeric profile ID. |
| `getProfileFeed(id, { cursor, limit, types })` | One raw page from the authenticated mixed profile feed. |
| `getProfileReplies(id, { cursor, limit })` | One raw page of comments and replies authored by the profile. |
| `getProfileNotes(id, { cursor })` | Raw, typed profile Notes feed. |
| `getPost(id)` | Post by global Substack ID. |
| `getPostManagementDetail(id)` | Raw, typed author analytics for one Post. Requires `publicationUrl` and publication access. |
| `getPostWithEngagement(id, { includeAutomodHidden })` | Full post, visible comment tree, and calculated engagement totals. Requires `publicationUrl`. |
| `getPostComments(id)` | Comments for a post. |
| `getEmailStats({ offset, orderBy, orderDirection })` | Publication email delivery and engagement stats. Uses Substack's required fixed page size of 20. Requires a publication administrator session. |
| `getAllEmailStats({ offset, orderBy, orderDirection })` | Fetches every 20-row email-stat page and returns one flat array of rows. |
| `getSubscriberStats()` | Publication subscriber records, tier breakdown, and aggregate count. |
| `getPaidSubscribers()` | Structured breakdown of paid vs free subscribers, subscription tiers, and pledges. |
| `getNotes({ cursor, profileId })` | Authenticated profile Notes feed (resolves profile ID automatically if omitted). |
| `getDraftNotes({ limit })` | Scheduled Note drafts for the authenticated account. Defaults to 20. |
| `getNote(id)` | Raw, typed Note by ID. |
| `getNoteWithEngagement(id)` | Raw Note and reply pages plus normalized, fully paginated visible reply totals. |
| `getComment(id)` | Comment by ID. |
| `getNoteReplies(id)` | Reply branches, root Note, and pagination metadata for a Note. |
| `deleteNote(id)` | Permanently deletes an authenticated user's Note or Note draft. |
| `setNoteLike(id, liked, options)` | Likes or unlikes a Note. |
| `commentOnNote(id, body, options)` | Adds a plain-text comment to a Note. |
| `deleteComment(id)` | Permanently deletes an authenticated user's comment. |
| `setNoteRestack(id, restacked, options)` | Restacks or removes a Note restack. |
| `getActivity(filter)` | Activity feed. Filters: `all`, `replies-and-mentions`, `restacks`. |
| `getActivityPage({ filter, after })` | One complete historical activity page with validated `more` and `nextAfter`. |
| `getUnreadActivity()` | Activity feed annotated using Substack's unread count. |
| `getFollowing({ profileId })` | Accounts followed by the authenticated account (or explicit profile ID). Resolves profile ID automatically if omitted. |
| `getSubscriptions({ handle, profileId })` | Publication subscriptions for the authenticated account (or public subscriptions for a handle or profile ID). |
| `testConnectivity()` | Whether the session can perform a lightweight authenticated API request. |
| `uploadImage(dataUrl)` | Uploads a base64 data-URL image and returns Substack media metadata. |
| `createImageAttachment(uploadedImage)` | Creates a Note image attachment from an uploaded image. |
| `createAttachment(request)` | Creates a link or image attachment for a Note. |
| `publishNote(request)` | Publishes a Note to the authenticated account's feed. |
| `scheduleNote(request)` | Creates a Note draft scheduled for publication at `triggerAt`. |
| `updateScheduledNote(id, request)` | Updates a scheduled Note draft and its publication time. |

Ordinary endpoint methods, including `getProfileFeed()`, `getProfileReplies()`, `getEmailStats()`, `getPostManagementDetail()`, `getNote()`, `getProfileNotes()`, and `getNoteReplies()`, return upstream JSON unchanged. Explicit convenience methods such as `getPostWithEngagement()`, `getNoteWithEngagement()`, and `getUnreadActivity()` add or normalize data. The package exports `SubstackApiError`, `SubstackConfigurationError`, `apiBase`, `ACTIVITY_FILTERS`, and its public TypeScript types. See [Engagement analytics API](docs/engagement-analytics.md) for the observed response structures and field semantics.

## Authenticated profile feed

`getProfileFeed()` calls the global reader endpoint and returns its mixed items without normalization. An unfiltered page can contain authored Notes, Note restacks, authored posts, post restacks, and other upstream variants. Unknown item, context, publication, post, comment, and pagination fields remain in the returned object.

```ts
const profileId = Number(process.env.SUBSTACK_PROFILE_ID!)
const page = await client.getProfileFeed(profileId, { limit: 20 })

for (const item of page.items) {
  console.log(item.context?.type, item.context?.source)
}
```

Every requested filter is encoded as a repeated `types[]` parameter. Confirmed filters are `note`, `replies`, `restack`, and `like`; arbitrary strings remain accepted because this is an undocumented API. `getProfileReplies()` applies `types[]=replies` for authored comments and replies, including activity on other profiles' content. `getProfileNotes()` retains its existing publication-scoped behavior but now also uses the correct `types[]=note` array parameter.

Use `nextCursor` as the next request's `cursor`. The observed `originalCursorTimestamp` field and any additional pagination metadata are retained unchanged.

```ts
const profileId = Number(process.env.SUBSTACK_PROFILE_ID!)
let cursor: string | undefined

do {
  const page = await client.getProfileReplies(profileId, {
    cursor,
    limit: 20
  })

  for (const item of page.items) {
    // Process the raw authored reply/comment and its context.
  }

  cursor = page.nextCursor ?? undefined
} while (cursor)
```

For Note restacks (`comment_restack` / `db-restack`), the target and its author fields are normally in `item.comment`. For post restacks (`post_restack` / `db-restack`), the target is in `item.post`, with authors commonly in `post.publishedBylines`; publication author fields can provide fallbacks. The SDK deliberately leaves these payloads raw instead of applying an application-specific author model.

The `restack` filter remains undocumented by Substack. An authenticated comparison on September 18, 2026 used the array form `types[]=restack` and returned both observed variants: 72 Note restacks and 28 post restacks across nine pages. The unfiltered feed remains necessary for complete mixed activity and as a fallback if upstream filter behavior changes.

Use `getProfileFeed(id, { types: ['like'] })` for the paginated Likes feed. An authenticated comparison on September 18, 2026 confirmed `note_like`, `comment_like`, and `post_like` entries with `context.source = "db-like"`, plus `nextCursor` and `originalCursorTimestamp`. Verification followed 30 pages and still had a next cursor, so the endpoint exposes deep history; because the API is undocumented, the SDK does not promise that Substack retains every Like indefinitely. A public profile's `hasLikes` value remains metadata rather than the collection itself.

The singular forms `types=comment`, `types=reply`, and `types=comment_reply`, and their array-form equivalents, are not supported by this SDK as confirmed filters; an empty response alone would not establish that those features never exist.

## Note engagement

```ts
const noteId = Number(process.env.SUBSTACK_NOTE_ID!)

await client.setNoteLike(noteId, true)
await client.setNoteLike(noteId, false)

const comment = await client.commentOnNote<{ id: number }>(
  noteId,
  'Super insightful!'
)
await client.deleteComment(comment.id)

await client.setNoteRestack(noteId, true)
await client.setNoteRestack(noteId, false)
```

Action methods return Substack's upstream JSON unchanged. `tabId`, `surface`, and `publicationId` have observed defaults and can be overridden through each method's options.

`getNote()`, `getProfileNotes()`, and `getNoteReplies()` return Substack's JSON unchanged with typed Note, feed-item, reply-branch, and pagination structures. Current Note engagement is carried by the Note's `comment` object:

| Metric | Confirmed raw field |
| --- | --- |
| Likes/reactions | `reaction_count` (`reactions` contains the per-reaction map) |
| Direct replies | `children_count` |
| Nested replies | No scalar field; aggregate each reply branch's `descendantComments` across all cursor pages |
| Total replies | Direct branches plus all `descendantComments` after complete pagination |
| Restacks | `restacks` |
| Viewer liked | `reaction === "❤"` |
| Viewer restacked | `restacked` |
| Views | Not present in the observed Note, profile-Note, or Note-reply responses |

`getNoteWithEngagement(id)` fetches the Note and follows every `getNoteReplies()` cursor. It returns the unchanged Note in `note`, unchanged pages in `replyPages`, flattened visible direct branches in `replies`, and a `NoteEngagement` object. `directReplyCount`, `nestedReplyCount`, and `totalReplyCount` are included only when all pages and branch arrays can be aggregated safely; `replyCountsComplete` states whether that calculation was reliable. Automoderated branches remain separate in the raw pages and are not mixed into visible totals.

The candidate fields `comment_count`, `reply_count`, `child_comment_count`, `descendant_comment_count`, `viewer_has_liked`, and `viewer_has_restacked` were not present on the audited Note objects. They remain optional in `NoteComment` for forward-compatible raw typing. Current viewer state comes from `reaction` and `restacked`.

## Post engagement

`getPostWithEngagement(id)` fetches the post and its comments concurrently. It returns the raw visible comment tree in `comments`, the same comments flattened depth-first in `commentItems`, and reported plus calculated visible engagement totals in `engagement`. Automoderated comments are excluded by default; request them separately with `includeAutomodHidden: true`.

```ts
const postId = Number(process.env.SUBSTACK_POST_ID!)
const result = await client.getPostWithEngagement(postId, {
  includeAutomodHidden: true
})

console.log(result.engagement.visibleCommentCount)
console.log(result.commentItems)
console.log(result.automodHiddenComments)
```

Author analytics are available separately through `getEmailStats()` and `getPostManagementDetail(id)`. The first returns `{ rows, total }`; the second returns `{ posts, total }`, with the requested Post's analytics under `posts[0].stats`. Both responses expose the same confirmed engagement names:

The email-stats endpoint requires `limit=20`; larger values currently return HTTP 400. The SDK therefore always sends 20 for `getEmailStats()` and every `getAllEmailStats()` page. The legacy `limit` option remains in the TypeScript interface for source compatibility but is deprecated and ignored.

| Metric | Confirmed raw field |
| --- | --- |
| Deliveries | `delivered` |
| Opens | `opens` |
| Clicks | `clicks` |
| Likes | `likes` |
| Comments | `comments` |
| Shares | `shares` |
| Restacks | `restacks` |
| Views | `views` |

`shares` and `restacks` are separate upstream counters. `opened` and `clicked` also appear alongside `opens` and `clicks`; consumers should preserve those raw fields rather than assuming undocumented equivalence. `getPostManagementDetail()` can additionally return link-level click tuples in `posts[].stats.links`.

```ts
const postId = Number(process.env.SUBSTACK_POST_ID!)
const emailPage = await client.getEmailStats()
const detail = await client.getPostManagementDetail(postId)

console.log(emailPage.rows?.[0]?.shares)
console.log(emailPage.rows?.[0]?.restacks)
console.log(detail.posts?.[0]?.stats?.delivered)
```

## Replies and mentions

Use `getActivity('replies-and-mentions')` for Substack's authenticated reply-and-mention activity feed (`/api/v1/activity-feed-web?filter=replies-and-mentions`). To show the five most recent activity items:

```ts
const activity = await client.getActivity('replies-and-mentions')
const latestFive = (activity.activityItems ?? []).slice(0, 5)
```

This is an activity feed, so it can include both replies and mentions. To fetch the comments for one particular post, use `getPostComments(postId)`.

For historical activity, use the separately exported `ActivityPageOptions` and
`ActivityPage` types with `getActivityPage()`:

```ts
const firstPage = await client.getActivityPage({ filter: 'all' })
// The consuming app decides when to request another page.
if (firstPage.nextAfter !== null) {
  const olderPage = await client.getActivityPage({
    filter: 'all',
    after: firstPage.nextAfter
  })
}
```

Each call makes exactly one authenticated GET to the global
`/api/v1/activity-feed-web?filter=...` endpoint, adding URL-encoded `after` when
provided. `filter` defaults to `all` and supports the same filters as
`getActivity()`. Input cursors and every item's `updated_at` must be valid ISO
8601 timestamps with a timezone (`Z` or a numeric offset) and at most three
fractional-second digits.

The result preserves all upstream fields, lookup tables, and every
`activityItems` record, adding explicit pagination metadata. `more` must be an
upstream boolean. When `more=true`, `nextAfter` is the **last item's `updated_at`
minus one millisecond**, formatted as a UTC ISO timestamp. For example,
`updated_at: 2026-09-05T21:53:10.058Z` produces
`nextAfter: 2026-09-05T21:53:10.057Z`, even if that item's `created_at` is
`2026-09-05T21:53:10.062Z`. When `more=false`, `nextAfter` is `null`, including
on an empty final page. These rules follow observed native Substack pagination.

Items retain Substack's native ranking, which need not be descending by
`updated_at`. Individual grouped items may be newer than an `after` cursor.
For a nonempty page, the final item's `updated_at` minus 1 ms must be strictly
earlier than the supplied cursor. Do not sort items or use the minimum timestamp
to derive a cursor. Invalid input throws `SubstackConfigurationError`
before requesting activity. Malformed responses, missing or invalid timestamps,
non-advancing pages, and empty pages with `more=true` throw
`SubstackApiError`; they are never interpreted as exhaustion.

Grouped activity can be created in April and updated in September. This method
preserves such records and never filters or paginates by `created_at`.
`getActivity()` retains its existing raw-response behavior. Date cutoffs,
automatic pagination, retries, scheduling, persistence, and resumable backfills
remain the consuming app's responsibility.

## Publishing Notes

`publishNote` creates public content. Its `bodyJson` is passed directly to Substack's ProseMirror-style Notes API. Create a link or image attachment first, then include its returned ID in `attachmentIds`.

```ts
const attachment = await client.createAttachment({
  url: 'https://example.com/article',
  type: 'link'
}) as { id: string }

await client.publishNote({
  bodyJson: {
    type: 'doc',
    attrs: { schemaVersion: 'v1' },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello, Substack.' }] }]
  },
  tabId: 'for-you',
  surface: 'feed',
  replyMinimumRole: 'everyone',
  attachmentIds: [attachment.id]
})
```

To upload and attach an image, pass the browser's `data:image/...;base64,...` value to `uploadImage`, then pass the upload result to `createImageAttachment`.

```ts
const image = await client.uploadImage('data:image/png;base64,...')
const attachment = await client.createImageAttachment(image)

await client.publishNote({
  bodyJson: { type: 'doc', attrs: { schemaVersion: 'v1' }, content: [] },
  tabId: 'for-you',
  surface: 'feed',
  replyMinimumRole: 'everyone',
  attachmentIds: [(attachment as { id: string }).id]
})
```

## Scheduling Notes

`scheduleNote` creates a server-side draft and schedules it for publication. Pass an ISO 8601 timestamp as `triggerAt`; the SDK sends it to Substack as `trigger_at`.

Use `createNoteBodyJson` to turn explicit `@handle` occurrences into Substack person-tag nodes. Each tag needs the person's public Substack user ID, handle, and display name.

```ts
const taggedProfileId = Number(process.env.SUBSTACK_PROFILE_ID!)

await client.scheduleNote({
  bodyJson: createNoteBodyJson('Scheduled note for @exampleauthor', [
    { id: taggedProfileId, handle: 'exampleauthor', label: 'Example Author' }
  ]),
  tabId: 'subscribed',
  surface: 'feed',
  replyMinimumRole: 'everyone',
  triggerAt: '2026-07-18T08:12:00.000Z'
})
```

## Managing scheduled drafts

`getDraftNotes` returns Substack's paged draft response, including each draft's `trigger_at`, attachments, `hasMore`, and `nextCursor` fields.

```ts
const drafts = await client.getDraftNotes({ limit: 20 })
```

`updateScheduledNote` updates a draft's content, publication time, and optional attachments. It sends `triggerAt` as Substack's `trigger_at` field and forwards attachment IDs from `attachmentIds`.

```ts
const scheduledNoteId = Number(process.env.SUBSTACK_SCHEDULED_NOTE_ID!)

await client.updateScheduledNote(scheduledNoteId, {
  bodyJson: { type: 'doc', attrs: { schemaVersion: 'v1' }, content: [] },
  replyMinimumRole: 'everyone',
  attachmentIds: ['attachment-or-note-id'],
  triggerAt: '2026-07-18T08:12:00.000Z'
})
```

`deleteNote` permanently deletes a Note or Note draft. Confirm the ID before calling it.

```ts
const noteId = Number(process.env.SUBSTACK_NOTE_ID!)
await client.deleteNote(noteId)
```

## Development

Contributors need Bun 1.2.19 and Node.js 18 or newer.

```sh
bun install --frozen-lockfile
bun run test:all
bun run build
bun run pack
```

`bun run build` produces minified ESM and declaration files in `dist/`. `bun run pack` builds first, then creates an npm-compatible tarball for local inspection.

## Maintainer publishing

The release workflow runs whenever a commit reaches `main`. It reads `package.json`; when that version is not yet on npm, it runs the full validation suite, publishes with provenance, and creates the matching GitHub Release automatically. If the npm version is already published but the GitHub Release is missing, the workflow creates only the missing release. It can also be rerun manually from the Actions tab.

The workflow uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) through GitHub Actions OIDC, so no `NPM_TOKEN` secret or npm GitHub environment is required.

For a brand-new npm package, publish the initial version manually after validation. Then add a GitHub Actions trusted publisher for `unofficial-substack-sdk` in npm, allowing `npm publish` from `cucoleadan/unofficial-substack-sdk` and `.github/workflows/publish.yml`. This requires an npm account with permission to publish the package. Subsequent new versions on `main` publish automatically with provenance.

To release a new version, update `package.json` using semantic versioning and merge that change into `main`. The workflow creates the matching tag and release (for example, `v0.1.1` for `0.1.1`). It never republishes an existing npm version.

## Maintainer pull requests

For pull requests into `main` from a branch in this repository, [owner auto-merge](.github/workflows/owner-auto-merge.yml) enables squash auto-merge when the author is `cucoleadan`. It never bypasses the branch rules or CI; GitHub merges only after all requirements pass. Enable **Settings → General → Pull Requests → Allow auto-merge** in the repository for this workflow to work.

## Security

Never include a Substack session token in a bug report, pull request, log, or test fixture. Please follow [SECURITY.md](SECURITY.md) for responsible vulnerability disclosure.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening an issue or pull request.

## License and acknowledgements

This project is licensed under the [MIT License](LICENSE). Endpoint research was informed by Jakub Slys's MIT-licensed `substack-api`; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
