#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/release.sh
#   ./scripts/release.sh --draft
#   ./scripts/release.sh --checksums
#   ./scripts/release.sh --app-zip
#   ./scripts/release.sh --draft --checksums
#   ./scripts/release.sh --draft --checksums --app-zip

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

DRAFT=false
CHECKSUMS=false
APP_ZIP=false

for arg in "$@"; do
  case "$arg" in
    --draft)
      DRAFT=true
      ;;
    --checksums)
      CHECKSUMS=true
      ;;
    --app-zip)
      APP_ZIP=true
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: ./scripts/release.sh [--draft] [--checksums] [--app-zip]"
      exit 1
      ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install it from https://cli.github.com/"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "You are not authenticated with GitHub CLI."
  echo "Run: gh auth login"
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

echo "🔨 Building release artifacts for ${TAG}..."
bun run make

if [ "$CHECKSUMS" = true ] && [ "$APP_ZIP" = true ]; then
  echo "📦 Preparing normalized artifacts with checksums and app zip..."
  bun run release:prepare:checksums:appzip
elif [ "$CHECKSUMS" = true ]; then
  echo "📦 Preparing normalized artifacts with checksums..."
  bun run release:prepare:checksums
elif [ "$APP_ZIP" = true ]; then
  echo "📦 Preparing normalized artifacts with app zip..."
  bun run release:prepare:appzip
else
  echo "📦 Preparing normalized artifacts..."
  bun run release:prepare
fi

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "❌ Release ${TAG} already exists on GitHub."
  echo "Delete it first or bump version in package.json."
  exit 1
fi

if [ "$DRAFT" = true ]; then
  echo "🚀 Creating DRAFT GitHub release ${TAG} with generated notes..."
  bun run release:publish:draft
else
  echo "🚀 Creating GitHub release ${TAG} with generated notes..."
  bun run release:publish
fi

echo "✅ Done: ${TAG}"
