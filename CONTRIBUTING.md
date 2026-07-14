# Contributing

Thanks for contributing to Unofficial Substack SDK.

## Development setup

Install Bun 1.2.19 and Node.js 18 or newer, then run:

```sh
bun install --frozen-lockfile
bun run test:all
```

Tests use mocked `fetch` implementations and do not require a Substack account or a session token.

## Making a change

1. Keep changes focused and avoid unrelated formatting churn.
2. Add or update a focused test for every behavior or endpoint change.
3. Run `bun run test:all` and `bun run build` before opening a pull request.
4. Update the README for public API, configuration, or security changes.
5. Never commit `.dev.vars`, `.env`, cookies, tokens, or real account data.

## API compatibility

Substack's web API is undocumented and can change without notice. New endpoints should include a source or reproducible observation, input validation where appropriate, a mocked request test, and clear documentation of any external side effect.

## Pull requests

Use a descriptive title, explain the user-facing impact, and link any relevant issue. By contributing, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
