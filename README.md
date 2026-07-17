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
import { SubstackClient } from 'unofficial-substack-sdk'

const client = new SubstackClient({
  sessionToken: process.env.SUBSTACK_SESSION_TOKEN!,
  publicationUrl: 'https://your-publication.substack.com'
})

const profile = await client.getAuthenticatedProfile()
const activity = await client.getActivity('all')
const notes = await client.getNotes()
```

`sessionToken` is the value of the `substack.sid` cookie only: do not pass `substack.sid=` or a complete `Cookie` header. Store it only in trusted server-side environment variables—never expose it in browser code, client bundles, issues, or logs.

`publicationUrl` is required for publication-scoped methods such as `getNotes`, `getNote`, `getComment`, `getPostComments`, `getEmailStats`, `getSubscriberStats`, `getProfileNotes`, and `getFollowing`. It accepts any HTTPS publication domain (including a custom domain) or a copied browser URL; query strings and fragments are discarded safely.

## Direct Substack requests only

This SDK has no Substack gateway dependency. Global API requests go directly to `https://substack.com` by default. Publication-scoped requests go directly to the `publicationUrl` you configure, including a custom domain.

Custom domains are supported, but they are a trust decision: the SDK sends the authenticated `substack.sid` cookie to the exact HTTPS origin in `publicationUrl`. Configure only a Substack publication domain you control or trust. Do not use a third-party, self-hosted, or closed-source Substack gateway, because it would receive that cookie. Redirects remain disabled so a configured origin cannot forward the cookie to another domain.

The optional `baseUrl` and legacy `substackUrl` overrides follow the same rule. Leave them unset for normal direct requests to `https://substack.com`; set either only when you intend to trust that HTTPS origin with the session cookie.

## Local configuration

Copy [`.dev.vars.example`](.dev.vars.example) to `.dev.vars` and replace the placeholders. The SDK does not load environment files itself; use your framework or local environment loader and pass the values into `SubstackClient`.

## API

| Method | Description |
| --- | --- |
| `getAuthenticatedProfile()` | Authenticated Substack profile. |
| `getPublicProfile(handle)` | Public profile by handle. |
| `getProfileById(id)` | Public profile by numeric user ID. |
| `getProfilePosts(id)` | Posts for a numeric profile ID. |
| `getProfileNotes(id, { cursor })` | Notes feed for a numeric profile ID. |
| `getPost(id)` | Post by global Substack ID. |
| `getPostWithEngagement(id, { includeAutomodHidden })` | Full post, visible comment tree, and calculated engagement totals. Requires `publicationUrl`. |
| `getPostComments(id)` | Comments for a post. |
| `getEmailStats({ offset, limit, orderBy, orderDirection })` | Publication email delivery and engagement stats. Defaults: `0`, `20`, `post_date`, `desc`. Requires a publication administrator session. |
| `getAllEmailStats({ offset, limit, orderBy, orderDirection })` | Fetches every email-stat page and returns one flat array of rows. |
| `getSubscriberStats()` | Publication subscriber records and aggregate count. The response may contain subscriber personal data. |
| `getNotes({ cursor })` | Authenticated publication Notes feed. |
| `getDraftNotes({ limit })` | Scheduled Note drafts for the authenticated account. Defaults to 20. |
| `getNote(id)` | Note by ID. |
| `getComment(id)` | Comment by ID. |
| `deleteNote(id)` | Permanently deletes an authenticated user's Note or Note draft. |
| `getActivity(filter)` | Activity feed. Filters: `all`, `replies-and-mentions`, `restacks`. |
| `getUnreadActivity()` | Activity feed annotated using Substack's unread count. |
| `getFollowing()` | Accounts followed by the authenticated account. |
| `testConnectivity()` | Whether the session can perform a lightweight API request. |
| `createAttachment({ url, type: 'link' })` | Creates a link attachment for a Note. |
| `publishNote(request)` | Publishes a Note to the authenticated account's feed. |
| `scheduleNote(request)` | Creates a Note draft scheduled for publication at `triggerAt`. |

The client returns upstream JSON unchanged, except `getUnreadActivity()` and `getPostWithEngagement()`, which add calculated convenience data. It exports `SubstackApiError`, `SubstackConfigurationError`, `apiBase`, `ACTIVITY_FILTERS`, and its public TypeScript types.

## Post engagement

`getPostWithEngagement(id)` fetches the post and its comments concurrently. It returns the raw visible comment tree in `comments`, the same comments flattened depth-first in `commentItems`, and reported plus calculated visible engagement totals in `engagement`. Automoderated comments are excluded by default; request them separately with `includeAutomodHidden: true`.

```ts
const result = await client.getPostWithEngagement(193463596, {
  includeAutomodHidden: true
})

console.log(result.engagement.visibleCommentCount)
console.log(result.commentItems)
console.log(result.automodHiddenComments)
```

## Replies and mentions

Use `getActivity('replies-and-mentions')` for Substack's authenticated reply-and-mention activity feed (`/api/v1/activity-feed-web?filter=replies-and-mentions`). To show the five most recent activity items:

```ts
const activity = await client.getActivity('replies-and-mentions')
const latestFive = (activity.activityItems ?? []).slice(0, 5)
```

This is an activity feed, so it can include both replies and mentions. To fetch the comments for one particular post, use `getPostComments(postId)`.

## Publishing Notes

`publishNote` creates public content. Its `bodyJson` is passed directly to Substack's ProseMirror-style Notes API. To attach a link, call `createAttachment` first and include its returned ID in `attachmentIds`.

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

## Scheduling Notes

`scheduleNote` creates a server-side draft and schedules it for publication. Pass an ISO 8601 timestamp as `triggerAt`; the SDK sends it to Substack as `trigger_at`.

```ts
await client.scheduleNote({
  bodyJson: {
    type: 'doc',
    attrs: { schemaVersion: 'v1', title: null },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Scheduled note' }] }]
  },
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

`deleteNote` permanently deletes a Note or Note draft. Confirm the ID before calling it.

```ts
await client.deleteNote(296235019)
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
