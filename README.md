# Kabi Notes

Alpha desktop notes app for local Markdown vaults.

Website: <https://kabinotes.com>

## Version

0.1.0-alpha.1

## Requirements

- Node.js >= 22.12.0
- Bun >= 1.3.10

## License

- Project license: MIT (see LICENSE)
- Third-party licenses: see THIRD_PARTY_NOTICES.md

## Release Binaries

Current target in this repository:

- macOS: `.dmg` (primary output)

### Release Process (CLI)

Releases are produced through a CLI workflow for reproducibility and traceability.

Artifacts are staged locally in:

- `releases/v<version>/`

Example:

- `releases/v0.1.0-alpha.1/`

### Prerequisites

- Release version finalized in `package.json`.
- GitHub CLI available and authenticated (`gh auth status`).
- Repository permissions sufficient to create releases and upload assets.

### What Gets Generated

`bun run release:prepare` selects the preferred installer from `out/make` and normalizes the output filename.

Example output on macOS:

- `Kabi Notes.dmg`
- `Kabi Notes.app`

Optional app bundle archive mode adds:

- `Kabi Notes.app.zip`

Checksum mode additionally produces:

- `SHA256SUMS.txt`

Note: GitHub release upload uses files only; local `.app` bundles are retained in `releases/` for manual distribution/testing.

### Release Commands

Preparation:

- `bun run make`
- `bun run release:prepare`
- `bun run release:prepare:appzip`
- `bun run release:prepare:checksums`
- `bun run release:prepare:checksums:appzip`

Combined local build + prepare:

- `bun run release:local`
- `bun run release:local:appzip`
- `bun run release:local:checksums`
- `bun run release:local:checksums:appzip`

Publish with GitHub CLI:

- `bun run release:publish:draft` (draft release)
- `bun run release:publish` (publish immediately)
- `bun run release:publish:dry-run` (command preview)

One-command end-to-end script:

- `./scripts/release.sh`
- `./scripts/release.sh --draft`
- `./scripts/release.sh --checksums`
- `./scripts/release.sh --app-zip`
- `./scripts/release.sh --draft --checksums`
- `./scripts/release.sh --draft --checksums --app-zip`

### Recommended Production Flow

1. Finalize version in `package.json`.
2. Build and prepare a draft release:
   - `./scripts/release.sh --draft`
3. Validate release notes and attached assets.
4. Publish the validated draft.

### How Release Notes Are Generated

Release notes are generated automatically by GitHub using:

- `gh release create --generate-notes`

Generated notes are based on changes since the previous release.

For controlled distributions, explicit notes can be provided with `--notes`.

### Common Issues

`Release already exists`:

- Bump version in `package.json` and try again.

`gh not authenticated`:

- Run `gh auth login`.

No assets found in `releases/v<version>/`:

- Run `bun run make` and then `bun run release:prepare`.
