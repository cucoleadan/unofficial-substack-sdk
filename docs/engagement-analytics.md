# Engagement analytics API

Substack's web API is undocumented and can change without notice. These structures were observed through authenticated, read-only requests on August 6, 2026. Raw endpoint methods deliberately preserve unknown fields through TypeScript index signatures and return the upstream JSON unchanged.

## Post analytics

### `getEmailStats(options?)`

Publication endpoint:

```text
GET /api/v1/publication/stats/email_stats
  ?offset=0
  &limit=20
  &order_by=post_date
  &order_direction=desc
```

The page size is fixed at 20. Live requests with a larger limit return HTTP 400, so the SDK always sends `limit=20` for both `getEmailStats()` and each `getAllEmailStats()` request. `EmailStatsOptions.limit` remains deprecated and ignored for source compatibility.

Return type: `EmailStatsPage<EmailStatsRow>`.

Observed envelope:

```ts
interface EmailStatsPage<T = EmailStatsRow> {
  rows?: T[]
  total?: number
  [key: string]: unknown
}
```

Each row contains Post identity and delivery, engagement, conversion, media, and audience fields. Confirmed engagement fields are:

```ts
interface EmailStatsRow {
  post_id?: number
  delivered?: number
  opened?: number
  opens?: number
  clicked?: number
  clicks?: number
  likes?: number
  comments?: number
  shares?: number
  restacks?: number
  views?: number
  // Additional observed fields and unknown future fields are retained.
}
```

Use `delivered`, `opens`, `clicks`, `likes`, `comments`, `shares`, and `restacks` for the requested Post metrics. `shares` and `restacks` are distinct fields and can contain different values. `opened` and `clicked` also exist, but their exact unique-versus-total semantics are not documented by Substack.

### `getPostManagementDetail(postId)`

Publication endpoint:

```text
GET /api/v1/post_management/detail/{post_id}
```

Return type: `PostManagementDetail<PostManagementPost>`.

Observed envelope:

```ts
interface PostManagementDetail<TPost = PostManagementPost> {
  posts?: TPost[]
  total?: number
  [key: string]: unknown
}

interface PostManagementPost {
  id?: number
  reaction_count?: number
  comment_count?: number
  child_comment_count?: number
  stats?: PostManagementStats
  [key: string]: unknown
}
```

`posts[0].stats` repeats the analytics fields from `EmailStatsRow`, including `delivered`, `opens`, `clicks`, `likes`, `comments`, `shares`, `restacks`, and `views`. It also includes link-level clicks in `links`, first-week daily stats, referrers, and comparison data when available. The Post object outside `stats` separately exposes content engagement such as `reaction_count`, `comment_count`, and `child_comment_count`.

Both numeric IDs and numeric strings are accepted. Zero, negative, fractional, unsafe, and non-numeric IDs throw `SubstackConfigurationError` before a request is made.

## Note analytics

### `getNote(noteId)`

Publication endpoint:

```text
GET /api/v1/reader/comment/{note_id}
```

Return type: `NoteResponse<NoteFeedItem>`.

Observed envelope:

```ts
interface NoteResponse {
  item?: NoteFeedItem
  [key: string]: unknown
}

interface NoteFeedItem {
  comment?: NoteComment
  trackingParameters?: NoteTrackingParameters
  [key: string]: unknown
}
```

### `getProfileNotes(profileId, options?)`

Publication endpoint:

```text
GET /api/v1/reader/feed/profile/{profile_id}?types=note[&cursor=...]
```

Return type: `ProfileNotesPage<NoteFeedItem>`.

Observed envelope fields are `items`, `nextCursor`, and `originalCursorTimestamp`. Every Note feed item carries its metrics under `item.comment`. The method returns that response unchanged; it does not add camel-case viewer fields.

### Note fields

The following fields were present on `item.comment` in both single-Note and profile-Note responses:

| Meaning | Raw field | Interpretation |
| --- | --- | --- |
| Likes/reactions | `reaction_count` | Total reaction count. Current Notes use the heart reaction. |
| Reaction map | `reactions` | Map such as `{ "❤": count }`. |
| Direct replies | `children_count` | Number of direct children of the Note. |
| Restacks | `restacks` | Directly available total restack count. |
| Viewer liked | `reaction` | `"❤"` when the authenticated viewer has liked; null/false/absent means not liked. |
| Viewer restacked | `restacked` | Boolean authenticated-viewer state. |

No Note view counter was present in `getNote()`, `getProfileNotes()`, or `getNoteReplies()`. In particular, `views` and `view_count` were absent from the audited Note objects.

The following commonly guessed fields were also absent from the audited Note objects: `comment_count`, `reply_count`, `child_comment_count`, `descendant_comment_count`, `viewer_has_liked`, and `viewer_has_restacked`. `NoteComment` types them as optional candidates so future upstream additions remain accessible, but current normalization does not require them.

### `getNoteReplies(noteId, options?)`

Global endpoint:

```text
GET https://substack.com/api/v1/reader/comment/{note_id}/replies
  ?comment_id={note_id}
  [&cursor=...]
```

Return type: `NoteRepliesResponse<NoteReplyBranch, NoteComment>`.

Observed response:

```ts
interface NoteRepliesResponse {
  commentBranches?: NoteReplyBranch[]
  moreBranches?: number
  nextCursor?: string | null
  rootComment?: NoteComment
  automodHiddenBranches?: NoteReplyBranch[]
  [key: string]: unknown
}

interface NoteReplyBranch {
  comment?: NoteComment          // one direct reply
  descendantComments?: Array<{
    comment?: NoteComment        // one nested reply at any deeper level
    type?: string
    [key: string]: unknown
  }>
  [key: string]: unknown
}
```

Each `commentBranches` entry represents one direct reply. Its `descendantComments` array contains the nested replies in that branch. Busy Notes are cursor-paginated; `moreBranches` can be positive and `nextCursor` non-null, so totals from only the first page are partial.

### `getNoteWithEngagement(noteId)`

Return type: `NoteWithEngagement`.

This convenience method makes one `getNote()` request and one or more `getNoteReplies()` requests until `nextCursor` is empty. It returns:

```ts
interface NoteWithEngagement {
  note: NoteResponse                   // unchanged upstream JSON
  replyPages: NoteRepliesResponse[]    // every unchanged upstream page
  replies: NoteReplyBranch[]           // visible direct branches, flattened by page
  engagement: NoteEngagement
}
```

Normalized fields are:

- `reactionCount`: `comment.reaction_count`.
- `reportedDirectReplyCount`: the Note's `comment.children_count`.
- `directReplyCount`: visible `commentBranches` across all pages.
- `nestedReplyCount`: visible `descendantComments` across all branches and pages.
- `totalReplyCount`: `directReplyCount + nestedReplyCount`.
- `restackCount`: `comment.restacks`.
- `viewerHasLiked`: `viewer_has_liked` if Substack ever supplies it, otherwise `reaction === "❤"`.
- `viewerHasRestacked`: `viewer_has_restacked` if supplied, otherwise `restacked`.
- `viewCount`: included only if a future response supplies a numeric `views` or `view_count` field.
- `replyCountsComplete`: whether every page and branch array was safe to aggregate.

When reply pagination or branch structure cannot be completed reliably, `directReplyCount`, `nestedReplyCount`, and `totalReplyCount` are omitted and `replyCountsComplete` is false. `automodHiddenBranches` remain available in each raw page but are excluded from visible totals.

## Request cost and aggregation

| Metric | Requests/calculation required |
| --- | --- |
| Post delivery/open/click/like/comment/share/restack/view totals | One `getEmailStats()` page or one `getPostManagementDetail()` request. |
| Post visible comment/reply tree totals | `getPostWithEngagement()` makes a Post request plus a publication comments request. |
| Note reactions, direct-reply report, restacks, viewer state | One `getNote()` or profile-Notes request. |
| Note visible direct, nested, and total replies | One Note request plus every cursor-paginated Note-replies request; calculated by `getNoteWithEngagement()`. |
| Note views | Unavailable in the observed endpoints. |
