#!/bin/bash
# Register custom AO plugins by shimming into ao's node_modules.
#
# AO 0.2.1 only loads plugins listed in BUILTIN_PLUGINS (plugin-registry.js).
# This script:
#   1. Replaces the built-in runtime-process with our enhanced version
#   2. Patches plugin-registry.js to add our custom agent entries
#   3. Creates npm package stubs for the custom agents
#
# Run at Docker build time (after npm install -g @composio/ao@0.2.1).
set -e

# Find @composio/ao (the top-level wrapper package), then navigate to its nested modules.
# @composio/ao-cli lives inside @composio/ao/node_modules/, not at the global root,
# so require.resolve('@composio/ao-cli') fails from outside that package.
AO_WRAPPER_DIR=$(node -e "console.log(require.resolve('@composio/ao/package.json').replace('/package.json',''))" 2>/dev/null) || true

if [ -z "$AO_WRAPPER_DIR" ]; then
  # Fallback: search common global paths
  for prefix in /usr/local/lib/node_modules /usr/lib/node_modules; do
    if [ -d "$prefix/@composio/ao" ]; then
      AO_WRAPPER_DIR="$prefix/@composio/ao"
      break
    fi
  done
fi

if [ -z "$AO_WRAPPER_DIR" ]; then
  echo "[register-plugins] FATAL: Could not find @composio/ao package"
  echo "[register-plugins] Searched: require.resolve, /usr/local/lib/node_modules, /usr/lib/node_modules"
  exit 1
fi

# All @composio plugins live as nested dependencies inside the ao wrapper
COMPOSIO_SCOPE="$AO_WRAPPER_DIR/node_modules/@composio"
echo "[register-plugins] AO wrapper at: $AO_WRAPPER_DIR"
echo "[register-plugins] @composio scope at: $COMPOSIO_SCOPE"

if [ ! -d "$COMPOSIO_SCOPE" ]; then
  echo "[register-plugins] FATAL: $COMPOSIO_SCOPE does not exist"
  ls -la "$AO_WRAPPER_DIR/node_modules/" 2>/dev/null | head -10
  exit 1
fi

# --- 1. Replace built-in runtime-process with our enhanced version ---
RUNTIME_PKG="$COMPOSIO_SCOPE/ao-plugin-runtime-process"
if [ -d "$RUNTIME_PKG" ]; then
  echo "[register-plugins] Replacing built-in runtime-process with custom version"
  cp /app/runtime-process.mjs "$RUNTIME_PKG/dist/index.js"
fi

# --- 2. Create agent-pi-rpc package stub ---
PI_PKG="$COMPOSIO_SCOPE/ao-plugin-agent-pi-rpc"
echo "[register-plugins] Creating agent-pi-rpc plugin package"
mkdir -p "$PI_PKG/dist"
cat > "$PI_PKG/package.json" << 'EOF'
{
  "name": "@composio/ao-plugin-agent-pi-rpc",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "exports": { ".": { "import": "./dist/index.js" } }
}
EOF
cp /app/adapters/agent-pi-rpc.mjs "$PI_PKG/dist/index.js"

# --- 3. Create agent-claude-code-headless package stub ---
CCH_PKG="$COMPOSIO_SCOPE/ao-plugin-agent-claude-code-headless"
echo "[register-plugins] Creating agent-claude-code-headless plugin package"
mkdir -p "$CCH_PKG/dist"
cat > "$CCH_PKG/package.json" << 'EOF'
{
  "name": "@composio/ao-plugin-agent-claude-code-headless",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "exports": { ".": { "import": "./dist/index.js" } }
}
EOF
cp /app/adapters/agent-claude-code-headless.mjs "$CCH_PKG/dist/index.js"

# --- 4. Patch plugin-registry.js to include our custom agents ---
# NOTE: 'codex' is intentionally NOT registered here. The ao/adapters/agent-codex.mjs
# adapter is a placeholder (see issue #797). Add a codex entry below only after the
# adapter is fully implemented and tested.
# ao-core is a sibling of ao-cli inside the wrapper's node_modules
AO_CORE_DIR="$COMPOSIO_SCOPE/ao-core"

REGISTRY="$AO_CORE_DIR/dist/plugin-registry.js"
if [ -f "$REGISTRY" ]; then
  if grep -q "pi-rpc" "$REGISTRY"; then
    echo "[register-plugins] plugin-registry.js already patched"
  else
    echo "[register-plugins] Patching plugin-registry.js to add custom agents"
    # Insert our entries after the opencode agent line
    sed -i '/{ slot: "agent", name: "opencode"/a\
    { slot: "agent", name: "pi-rpc", pkg: "@composio/ao-plugin-agent-pi-rpc" },\
    { slot: "agent", name: "claude-code-headless", pkg: "@composio/ao-plugin-agent-claude-code-headless" },' "$REGISTRY"

    # Verify the patch landed
    if ! grep -q "pi-rpc" "$REGISTRY"; then
      echo "[register-plugins] FATAL: plugin-registry.js patch FAILED"
      echo "[register-plugins] Registry contents:"
      grep -n "BUILTIN" "$REGISTRY" | head -5
      exit 1
    fi
    echo "[register-plugins] ✓ plugin-registry.js patched successfully"
  fi
else
  echo "[register-plugins] WARNING: Could not find plugin-registry.js at $REGISTRY"
fi

# --- 5. Patch built-in claude-code agent to use --bare mode ---
# Claude Code v2.1.86+ prompts "Do you want to use this API key?" in interactive mode.
# --bare bypasses this by using ANTHROPIC_API_KEY directly from env (no OAuth/keychain).
CC_PKG="$COMPOSIO_SCOPE/ao-plugin-agent-claude-code"
CC_INDEX="$CC_PKG/dist/index.js"
if [ -f "$CC_INDEX" ]; then
  if grep -q '"--bare"' "$CC_INDEX"; then
    echo "[register-plugins] claude-code already patched with --bare"
  else
    echo "[register-plugins] Patching built-in claude-code to add --bare flag"
    sed -i 's/const parts = \["claude"\];/const parts = ["claude", "--bare"];/' "$CC_INDEX"
    if grep -q '"--bare"' "$CC_INDEX"; then
      echo "[register-plugins] ✓ claude-code --bare patch applied"
    else
      echo "[register-plugins] WARNING: --bare patch did not apply (non-fatal)"
    fi
  fi
fi

echo "[register-plugins] Plugin registration complete"
