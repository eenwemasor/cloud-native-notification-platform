#!/usr/bin/env bash
# setup-registry.sh — start a local Docker registry on this host and configure:
#   • this host's Docker daemon (push side)
#   • every running Multipass kubeadm node's containerd (pull side)
#
# Run ONCE before your first `skaffold run`.  Safe to re-run (idempotent).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REGISTRY_PORT="${REGISTRY_PORT:-5000}"
REGISTRY_NAME="local-registry"

# ── 1. Detect host IP as seen from Multipass VMs ─────────────────────────────
echo "==> Detecting host IP reachable from Multipass VMs..."

FIRST_NODE=$(multipass list --format csv 2>/dev/null \
  | awk -F, 'NR>1 && $2=="Running" {print $1; exit}')

if [[ -z "$FIRST_NODE" ]]; then
  echo "ERROR: No running Multipass VMs found. Start your kubeadm cluster first." >&2
  exit 1
fi

HOST_IP=$(multipass exec "$FIRST_NODE" -- \
  ip route show default | awk '/default/ {print $3; exit}')

if [[ -z "$HOST_IP" ]]; then
  echo "ERROR: Could not determine host IP from VM '$FIRST_NODE'." >&2
  exit 1
fi

REGISTRY="${HOST_IP}:${REGISTRY_PORT}"
echo "    Host IP (bridge) : $HOST_IP"
echo "    Registry address : $REGISTRY"

# ── 2. Configure host Docker daemon for the insecure registry ─────────────────
# Docker only allows HTTP (insecure) pushes to localhost/127.0.0.1 by default.
# Pushing to <HOST_IP>:5000 requires an explicit insecure-registries entry.
echo "==> Configuring host Docker daemon for insecure registry $REGISTRY..."

DAEMON_JSON="/etc/docker/daemon.json"
if [[ -f "$DAEMON_JSON" ]]; then
  # Merge into existing config with Python (always available on Ubuntu/Debian)
  sudo python3 - "$DAEMON_JSON" "$REGISTRY" <<'PYEOF'
import json, sys
path, reg = sys.argv[1], sys.argv[2]
with open(path) as f:
    cfg = json.load(f)
lst = cfg.setdefault("insecure-registries", [])
if reg not in lst:
    lst.append(reg)
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)
    print(f"    Added {reg} to insecure-registries")
else:
    print(f"    {reg} already in insecure-registries")
PYEOF
else
  echo "{\"insecure-registries\": [\"${REGISTRY}\"]}" \
    | sudo tee "$DAEMON_JSON" > /dev/null
  echo "    Created $DAEMON_JSON"
fi

echo "==> Reloading Docker daemon..."
sudo systemctl reload docker 2>/dev/null || sudo systemctl restart docker

# ── 3. Start the registry container on the host ───────────────────────────────
if docker ps --format '{{.Names}}' | grep -q "^${REGISTRY_NAME}$"; then
  echo "==> Registry '${REGISTRY_NAME}' already running."
else
  echo "==> Starting registry container '${REGISTRY_NAME}' on port ${REGISTRY_PORT}..."
  docker run -d \
    --name "${REGISTRY_NAME}" \
    --restart=always \
    -p "${REGISTRY_PORT}:5000" \
    registry:2
fi

# ── 4. Configure containerd on every kubeadm node ────────────────────────────
# containerd >= 1.6 uses per-registry hosts.toml files.
NODES=$(multipass list --format csv 2>/dev/null \
  | awk -F, 'NR>1 && $2=="Running" {print $1}')

for node in $NODES; do
  echo "==> Configuring containerd on node '$node'..."
  multipass exec "$node" -- bash -s <<EOF
set -euo pipefail
CERT_DIR="/etc/containerd/certs.d/${REGISTRY}"
sudo mkdir -p "\$CERT_DIR"
sudo tee "\$CERT_DIR/hosts.toml" > /dev/null <<TOML
server = "http://${REGISTRY}"
[host."http://${REGISTRY}"]
  capabilities = ["pull", "resolve"]
  skip_verify   = true
TOML

# Point containerd at the certs.d directory (one-time, idempotent)
CONF=/etc/containerd/config.toml
if ! sudo grep -q 'config_path.*certs.d' "\$CONF" 2>/dev/null; then
  sudo sed -i '/\[plugins."io.containerd.grpc.v1.cri".registry\]/a\      config_path = "/etc/containerd/certs.d"' "\$CONF" 2>/dev/null || true
fi
sudo systemctl restart containerd
echo "    containerd restarted on $node"
EOF
done

# ── 5. Smoke-test ─────────────────────────────────────────────────────────────
echo "==> Smoke-testing push to $REGISTRY..."
docker pull --quiet alpine:3.20
docker tag alpine:3.20 "${REGISTRY}/probe:test"
if docker push "${REGISTRY}/probe:test" > /dev/null 2>&1; then
  docker rmi "${REGISTRY}/probe:test" > /dev/null 2>&1 || true
  echo "    Push OK."
else
  echo ""
  echo "WARNING: Push to ${REGISTRY} failed." >&2
  echo "  Check that port ${REGISTRY_PORT} is not blocked by a firewall." >&2
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "Setup complete. Run the following before using skaffold:"
echo ""
echo "    export SKAFFOLD_DEFAULT_REPO=${REGISTRY}"
echo ""
echo "Then:"
echo "    skaffold run          # build + push + deploy"
echo "    skaffold dev          # watch mode"
echo "    skaffold delete       # tear down"
