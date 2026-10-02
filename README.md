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
| `getDraftNotes({ limit, cursor })` | One typed page of scheduled and unscheduled Note drafts. `limit` is 1–100 (default 20). |
| `getAllDraftNotes({ maxItems, pageSize })` | Follows draft cursors and returns up to `maxItems` drafts (default 500). |
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
| `uploadImage(image, { contentType })` | Uploads a data-URL string, `Blob`, `ArrayBuffer`, or `Uint8Array` image and returns Substack media metadata. |
| `createImageAttachment(uploadedImage)` | Creates a Note image attachment from an uploaded image and returns its ID. |
| `createAttachment(request)` | Creates a link or image attachment for a Note and returns its ID. |
| `publishNote(request)` | Publishes a Note to the authenticated account's feed and returns it. |
| `scheduleNote(request)` | Creates a Note draft scheduled for `triggerAt` and returns it. |
| `createDraftNote(request)` | Creates an unscheduled Note draft and returns it. |
| `updateScheduledNote(id, request)` | Replaces a draft's body, reply role, attachments, and schedule. |
| `unscheduleNote(id, request)` | Removes a draft's schedule and keeps it as an unscheduled draft. |

Ordinary endpoint methods, including `getProfileFeed()`, `getProfileReplies()`, `getEmailStats()`, `getPostManagementDetail()`, `getNote()`, `getProfileNotes()`, and `getNoteReplies()`, return upstream JSON unchanged. Explicit convenience methods such as `getPostWithEngagement()`, `getNoteWithEngagement()`, and `getUnreadActivity()` add or normalize data. The package exports `SubstackApiError`, `SubstackConfigurationError`, `apiBase`, `ACTIVITY_FILTERS`, the Note body helpers (`createNoteBodyJson`, `noteBodyJsonToText`, `normalizeNoteBodyJson`, `markdownToNoteBodyJson`, and `noteBodyJsonToMarkdown`), and its public TypeScript types. See [Engagement analytics API](docs/engagement-analytics.md) for the observed response structures and field semantics.

Failed requests throw `SubstackApiError` with `status`, `url`, and `detail`, which is the upstream response body truncated to 500 characters. When Substack sends an error message, `upstreamMessage` holds it, such as `Please type a shorter comment`, and validation failures also set `issues`. Substack's validation responses repeat the submitted value, so the SDK removes each repeated `value` and redacts the session token. Error details never contain cookies or request bodies. Some messages, such as `Please type a shorter comment`, can be shown to readers; others, such as `trigger_at: Invalid value`, are technical, and some are empty.

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

`publishNote` creates public content. Its `bodyJson` is passed directly to Substack's ProseMirror-style Notes API. Create a link or image attachment first, then include its returned ID in `attachmentIds`. The method returns the published comment as a `PublishNoteResponse`, whose `id` is the Note ID.

```ts
const attachment = await client.createAttachment({
  url: 'https://example.com/article',
  type: 'link'
})

const note = await client.publishNote({
  bodyJson: createNoteBodyJson('Hello, Substack.'),
  tabId: 'for-you',
  surface: 'feed',
  replyMinimumRole: 'everyone',
  attachmentIds: [attachment.id]
})
const noteId = note.id
```

To upload and attach an image, pass a `data:image/...;base64,...` string to `uploadImage`, or pass a `Blob`, `ArrayBuffer`, or `Uint8Array` with an image content type. Then pass the upload result to `createImageAttachment`.

```ts
const image = await client.uploadImage(fileBytes, { contentType: 'image/png' })
const attachment = await client.createImageAttachment(image)

await client.publishNote({
  bodyJson: createNoteBodyJson('Look at this.'),
  tabId: 'for-you',
  surface: 'feed',
  replyMinimumRole: 'everyone',
  attachmentIds: [attachment.id]
})
```

Attachment and image facts observed against Substack:

- A Note can have up to 6 attachments. Images can be combined with one link attachment. Two link attachments, or a seventh attachment, fail with HTTP 400 and an empty error message.
- `uploadImage` accepted PNG, JPEG, GIF, WebP, AVIF, BMP, TIFF, and SVG. A 22 MB image was accepted; 35 MB failed with HTTP 413 `Your upload is too large.` A data URL that is not `image/*` fails with `Invalid data uri`.
- Substack does not check that the uploaded bytes are a real image, so validate files in your application.
- Whether unused attachment IDs expire has not been verified. Create attachments shortly before you use them.

To publish a saved draft immediately, pass its ID as `draftCommentId`. Substack publishes the Note under the draft's ID and removes the draft, as its web composer's **Post** button does.

## Formatting Notes

Note bodies are TipTap/ProseMirror documents. `publishNote`, `scheduleNote`, and `createDraftNote` send `bodyJson` unchanged, and every read method returns Substack's `body_json` unchanged, so formatting, mentions, and links survive in both directions.

Substack Notes support these nodes and marks, which the `NoteRichDocument` type describes:

| Supported | Not supported |
|---|---|
| Paragraphs, bulleted and numbered lists (nested), quotes, code blocks | Headings, horizontal rules, images in text |
| Bold, italic, strikethrough, inline code, links | Underline, custom link text |
| Mentions of users (`mentionType: "user"`) and publications (`"pub"`) | Hard breaks (stored as paragraph breaks), blank lines |

Substack changes some documents when it stores them. These behaviors were verified by publishing test Notes:

- A space that sits on its own between two formatted words is deleted, so `**bold** *italic*` is stored as **bold***italic*.
- Link text is replaced by the URL. Link attributes are kept as sent.
- Hard breaks become paragraph breaks, and empty paragraphs are removed.
- A document with an unsupported node or mark, such as a heading, is rejected with HTTP 500 and an empty message.

`normalizeNoteBodyJson` rewrites a document into the form Substack stores unchanged, so the Note you read back after publishing equals the document you sent. It moves an isolated space into a neighboring plain, bold, or italic word; it never moves a space into inline code or a link. It also replaces link text with the URL, splits paragraphs at hard breaks, and removes empty paragraphs. For unsupported formatting it throws `SubstackConfigurationError` and names each problem, instead of letting Substack return a 500.

```ts
import { normalizeNoteBodyJson } from 'unofficial-substack-sdk'

// For example, the JSON from a TipTap editor's getJSON().
const bodyJson = normalizeNoteBodyJson(editorJson)
const note = await client.publishNote({ bodyJson, tabId: 'for-you', surface: 'feed', replyMinimumRole: 'everyone' })
// note.body_json equals bodyJson.
```

### Note Markdown

If your application edits Notes as text, `markdownToNoteBodyJson` and `noteBodyJsonToMarkdown` convert between Note Markdown and Substack's document format without losing formatting, mentions, or links:

````md
Hi @Example Author, **bold** *italic* ~~strikethrough~~ `code` and https://example.com
- bulleted item
  - nested item
1. numbered item
> quoted line
```ts
const fenced = 'code block'
```
````

- Each line is one paragraph; blank lines separate two adjacent lists or quotes and are otherwise ignored.
- `*italic*` and `_italic_` are equivalent. Bare `http://` and `https://` URLs become links; trailing punctuation is not part of the URL.
- `@handle` becomes a mention for each person tag you supply, as in `createNoteBodyJson`. Add `mentionType: 'pub'` to a tag to mention a publication.
- A backslash makes the next character literal: `\*`, `\_`, `\@`, `\-`, `\>`, `1\.`, or `https\://`.

```ts
import { markdownToNoteBodyJson, noteBodyJsonToMarkdown } from 'unofficial-substack-sdk'

const bodyJson = markdownToNoteBodyJson('Thanks **@Example Author** for https://example.com', [
  { id: taggedProfileId, label: 'Example Author' }
])

// Later, edit a draft or published Note as Markdown.
const editable = noteBodyJsonToMarkdown(draft.body_json)
if (editable) {
  const updated = markdownToNoteBodyJson(editedMarkdown, editable.personTags)
}
```

`markdownToNoteBodyJson` returns a normalized document, so Substack stores it unchanged. `noteBodyJsonToMarkdown` returns `{ markdown, personTags }`, which converts back to the same document. Mark order and Substack's default link, list, and code-block attributes do not count as differences. It returns `null` when exact conversion is impossible: for unsupported formatting, a list item with two paragraphs, inline code containing a backtick, or one person mentioned with two different labels or URLs. The 5,000-character limit applies to visible text, not to Markdown syntax.

## Scheduling Notes

`scheduleNote` creates a server-side draft and returns it as a `ScheduledNoteResponse`. Its numeric `id` is the draft ID for `updateScheduledNote` and `deleteNote`. Pass an ISO 8601 timestamp as `triggerAt`; the SDK sends it to Substack as `trigger_at`. To save a draft without a schedule, use `createDraftNote`, which takes the same fields without `triggerAt`.

Use `createNoteBodyJson` to turn explicit `@handle` occurrences into Substack person-tag nodes. Each tag needs the person's public Substack user ID, handle, and display name.

```ts
const taggedProfileId = Number(process.env.SUBSTACK_PROFILE_ID!)

const draft = await client.scheduleNote({
  bodyJson: createNoteBodyJson('Scheduled note for @exampleauthor', [
    { id: taggedProfileId, handle: 'exampleauthor', label: 'Example Author' }
  ]),
  tabId: 'for-you',
  surface: 'feed',
  replyMinimumRole: 'everyone',
  attachmentIds: [attachment.id],
  triggerAt: '2026-11-02T08:15:00.000Z'
})
const draftId = draft.id
```

Request fields:

- `tabId` and `surface` record where the Note was composed. Substack accepts drafts without them, so `createDraftNote` makes them optional; `scheduleNote` and `publishNote` require them. Use `for-you` and `feed` unless you have a reason to send another context.
- `replyMinimumRole` is `everyone`, `free_subscriber` (subscribers only), or `paid_subscriber`. Other values fail with HTTP 400. If the field is omitted, Substack stores `null`.
- `attachmentIds` follows the attachment limits in [Publishing Notes](#publishing-notes).

### Note text

`createNoteBodyJson` turns each non-empty line into one paragraph and drops blank lines. Substack cannot store a blank line: it discards empty paragraphs and turns hard breaks into paragraph breaks. Paragraphs already render with space between them. The SDK limits text to 5,000 characters. Substack accepted 5,001 characters and rejected 20,000 with `Please type a shorter comment`.

`noteBodyJsonToText` reverses `createNoteBodyJson`. It returns `{ text, personTags }` for a document that contains only paragraphs, unformatted text, and user mentions. It returns `null` for links, bold or italic marks, lists, hard breaks, and any other node, so your application can tell when a draft cannot be edited as plain text without losing content. For formatted Notes, use [Note Markdown](#note-markdown) instead.

```ts
const editable = noteBodyJsonToText(draft.body_json)

if (editable) {
  // editable.text has one line per paragraph and `@Label` for each mention.
  const bodyJson = createNoteBodyJson(editedText, editable.personTags)
}
```

The round trip is exact: `createNoteBodyJson(text, personTags)` rebuilds the original document. Text that goes from text to a document and back is unchanged, except that blank lines are removed and `\r\n` becomes `\n`.

### Timing, lead time, and cancellation

- `trigger_at` can be at most 92 days ahead. A later time fails with HTTP 400 `trigger_at cannot be more than 92 days in the future`, **but Substack still creates an unscheduled draft**. After this error, find the stray draft with `getDraftNotes` and delete it before you retry.
- A `trigger_at` that is not a valid date, or one in the past, fails with HTTP 400 (`trigger_at must be in the future`) and creates no draft.
- There is no minimum lead time: drafts scheduled 30, 60, and 90 seconds ahead were accepted. In one test run, Substack published between 0.1 and 1.8 seconds after `trigger_at`.
- A published Note keeps its draft ID, so the draft `id` is also the Note `id`.
- `deleteNote(draftId)` cancels a draft and returns `{}`. Deleting the same ID again fails with HTTP 403 and an empty body.
- Cancelling worked up to `trigger_at`. In one test run, deletes sent 10 seconds before, 2 seconds before, and exactly at `trigger_at` all stopped the Note. After `trigger_at`, the same `deleteNote(draftId)` call removes the published Note, but it will have been public for those seconds.

For a **Post now** button with an **Abort** option, choose one of these approaches:

- **Schedule it.** Call `scheduleNote` with `triggerAt` set a short time ahead, and call `deleteNote` to abort. Disable **Abort** a second or two before `trigger_at` so an abort never arrives after publication.
- **Hold it in your application.** Keep the Note in your own queue during the undo window, and call `publishNote` when the window ends. Aborting removes it from your queue, so it can never reach Substack.
- **Save a draft first.** Create the draft with `createDraftNote`, and call `publishNote({ ..., draftCommentId })` when the window ends. Aborting deletes the draft.

## Managing scheduled drafts

`getDraftNotes` returns one typed page of `DraftNote` objects. It includes both scheduled drafts and unscheduled drafts, which have `trigger_at: null`. Each draft has its `id`, `body` (plain text), `body_json`, `trigger_at`, `date`, `edited_at`, `reply_minimum_role`, and `attachments`. Upstream fields without a declared type are retained.

`limit` must be between 1 and 100; the default is 20. To get the next page, pass `nextCursor` as `cursor`. When `nextCursor` is `null`, there are no more pages. A malformed cursor fails with HTTP 400 `Invalid cursor format`.

```ts
const firstPage = await client.getDraftNotes({ limit: 100 })
const secondPage = firstPage.nextCursor
  ? await client.getDraftNotes({ limit: 100, cursor: firstPage.nextCursor })
  : undefined

const allDrafts = await client.getAllDraftNotes({ maxItems: 1_000 })
const scheduled = allDrafts.filter((draft) => draft.trigger_at)
```

`getAllDraftNotes` follows cursors until there are no more pages or it has collected `maxItems` drafts. `maxItems` defaults to 500 and can be up to 10,000. It skips duplicate drafts. It throws `SubstackApiError` instead of returning partial results when Substack repeats a cursor, omits the `drafts` array, or reports `hasMore` without a cursor.

`updateScheduledNote` replaces a draft's body, reply role, attachments, and schedule. Substack replaces the draft's attachments with `attachmentIds`, so **omitting it removes every attachment**; always pass the IDs that should remain. Every update must include `bodyJson`; an update with only `trigger_at` fails with `Please add a comment or an attachment.` To keep a draft but remove its schedule, call `unscheduleNote`. It sends `trigger_at: null` with the draft's content, which is the request Substack's composer sends for **Remove schedule**.

```ts
await client.updateScheduledNote(draft.id, {
  bodyJson: createNoteBodyJson('Updated scheduled note'),
  replyMinimumRole: 'everyone',
  attachmentIds: draft.attachments?.map((attachment) => attachment.id) ?? [],
  triggerAt: '2026-11-03T09:00:00.000Z'
})

// Keep the draft but remove its schedule.
await client.unscheduleNote(draft.id, {
  bodyJson: draft.body_json,
  replyMinimumRole: draft.reply_minimum_role ?? 'everyone',
  attachmentIds: draft.attachments?.map((attachment) => attachment.id) ?? []
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
