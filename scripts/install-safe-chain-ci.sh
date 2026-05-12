#!/usr/bin/env bash

# Dette skriptet laster ned og installerer safe-chain CLI-verktøyet i en CI-miljø. 
# Det bestemmer riktig versjon og sjekksum basert på plattformen, laster ned den aktuelle binærfilen, verifiserer integriteten ved hjelp av SHA256-sjekksummen, 
# og installerer den i brukerens lokale bin
set -euo pipefail

SAFE_CHAIN_VERSION="1.4.7"
INSTALL_DIR="${HOME}/.local/bin"
INSTALL_PATH="${INSTALL_DIR}/safe-chain"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    SAFE_CHAIN_ASSET="safe-chain-linuxstatic-x64"
    SAFE_CHAIN_SHA256="240086114c5e628b99ab850f0b9518a587036cd3688603193be839cfd9520f92"
    ;;
  Linux-aarch64 | Linux-arm64)
    SAFE_CHAIN_ASSET="safe-chain-linuxstatic-arm64"
    SAFE_CHAIN_SHA256="a002911cd0a9368d0a4cf73098d2e3a354bf0f09450dcd7e3343c3863ff4e7f1"
    ;;
  Darwin-x86_64)
    SAFE_CHAIN_ASSET="safe-chain-macos-x64"
    SAFE_CHAIN_SHA256="d755716330925497ac4678d72e5df63f49152c6daec7375460bd4c88b7af824d"
    ;;
  Darwin-arm64)
    SAFE_CHAIN_ASSET="safe-chain-macos-arm64"
    SAFE_CHAIN_SHA256="b9348e5f70abed23b7ec5e2803b7733e74fc4c8de4a605dd8ff3741d85d07824"
    ;;
  *)
    echo "Unsupported safe-chain platform: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

SAFE_CHAIN_URL="https://github.com/AikidoSec/safe-chain/releases/download/${SAFE_CHAIN_VERSION}/${SAFE_CHAIN_ASSET}"
DOWNLOAD_PATH="/tmp/safe-chain-${SAFE_CHAIN_VERSION}-${SAFE_CHAIN_ASSET}"

mkdir -p "$INSTALL_DIR"

curl -fsSL --retry 5 --retry-delay 10 --retry-all-errors \
  "$SAFE_CHAIN_URL" \
  -o "$DOWNLOAD_PATH"

if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "$SAFE_CHAIN_SHA256" "$DOWNLOAD_PATH" | sha256sum -c -
elif command -v shasum >/dev/null 2>&1; then
  printf '%s  %s\n' "$SAFE_CHAIN_SHA256" "$DOWNLOAD_PATH" | shasum -a 256 -c -
else
  echo "sha256sum or shasum is required to verify safe-chain" >&2
  exit 1
fi

install -m 0755 "$DOWNLOAD_PATH" "$INSTALL_PATH"

if [ -n "${GITHUB_PATH:-}" ]; then
  printf '%s\n' "$INSTALL_DIR" >> "$GITHUB_PATH"
fi

"$INSTALL_PATH" -v
