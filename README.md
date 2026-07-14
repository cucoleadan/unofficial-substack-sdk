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

`publicationUrl` is required for publication-scoped methods such as `getNotes`, `getNote`, `getComment`, `getPostComments`, `getProfileNotes`, and `getFollowing`. It accepts a bare host or a copied browser URL; query strings and fragments are discarded safely.

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
| `getPostComments(id)` | Comments for a post. |
| `getNotes({ cursor })` | Authenticated publication Notes feed. |
| `getNote(id)` | Note by ID. |
| `getComment(id)` | Comment by ID. |
| `getActivity(filter)` | Activity feed. Filters: `all`, `replies-and-mentions`, `restacks`. |
| `getUnreadActivity()` | Activity feed annotated using Substack's unread count. |
| `getFollowing()` | Accounts followed by the authenticated account. |
| `testConnectivity()` | Whether the session can perform a lightweight API request. |
| `createAttachment({ url, type: 'link' })` | Creates a link attachment for a Note. |
| `publishNote(request)` | Publishes a Note to the authenticated account's feed. |

The client returns upstream JSON unchanged, except `getUnreadActivity()`, which returns an annotated activity feed. It exports `SubstackApiError`, `SubstackConfigurationError`, `apiBase`, `ACTIVITY_FILTERS`, and its public TypeScript types.

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

The publish workflow runs only when a GitHub Release is published. Before creating the first release, configure an npm access token as the repository's `NPM_TOKEN` secret and create the `npm` GitHub environment. The workflow runs the full validation suite and publishes with npm provenance.

## Security

Never include a Substack session token in a bug report, pull request, log, or test fixture. Please follow [SECURITY.md](SECURITY.md) for responsible vulnerability disclosure.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening an issue or pull request.

## License and acknowledgements

This project is licensed under the [MIT License](LICENSE). Endpoint research was informed by Jakub Slys's MIT-licensed `substack-api`; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
