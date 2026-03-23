#!/bin/bash
# Build the NanoClaw agent container image
# Concatenates Dockerfile + any Dockerfile.* extensions (skills add these)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/.."

IMAGE_NAME="nanoclaw-agent"
TAG="${1:-latest}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"

echo "Building NanoClaw agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

# Build context is repo root so extension Dockerfiles can COPY paths.
# Rewrite base Dockerfile's agent-runner/ paths to container/agent-runner/.
{
    sed 's|agent-runner/|container/agent-runner/|g' "$SCRIPT_DIR/Dockerfile"
    for ext in "$SCRIPT_DIR"/Dockerfile.*; do
        if [ -f "$ext" ]; then
            echo "# --- $(basename "$ext") ---"
            cat "$ext"
        fi
    done
} | ${CONTAINER_RUNTIME} build -t "${IMAGE_NAME}:${TAG}" -f - "$REPO_ROOT"

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | ${CONTAINER_RUNTIME} run -i ${IMAGE_NAME}:${TAG}"
