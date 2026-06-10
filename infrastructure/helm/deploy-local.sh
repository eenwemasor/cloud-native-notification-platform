#!/usr/bin/env bash
# deploy-local.sh — manual Helm upgrade as an alternative to `skaffold run`.
#
# Use this only when you have already built and pushed images manually
# (or want to re-deploy with the same images without a rebuild).
#
# Preferred workflow for kubeadm/Multipass:
#   1. ./infrastructure/scripts/setup-registry.sh
#   2. export REGISTRY=<host-ip>:5000
#   3. skaffold run         ← build + push + deploy in one step
#      skaffold dev         ← same + watch for file changes
#
# This script is useful for deploying specific image tags or for CI
# pipelines that build images in a separate step.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REGISTRY="${SKAFFOLD_DEFAULT_REPO:-}"
if [[ -z "$REGISTRY" ]]; then
  echo "ERROR: SKAFFOLD_DEFAULT_REPO env var is not set." >&2
  echo "Run ./infrastructure/scripts/setup-registry.sh first, then:" >&2
  echo "  export SKAFFOLD_DEFAULT_REPO=<host-ip>:5000" >&2
  exit 1
fi

GATEWAY_TAG="${GATEWAY_TAG:-latest}"
EMAIL_TAG="${EMAIL_TAG:-latest}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART="$SCRIPT_DIR/notification-platform"
RELEASE="notification-platform"
NAMESPACE="notifications"

echo "==> Deploying release '$RELEASE' in namespace '$NAMESPACE'"
echo "    gateway image      : ${REGISTRY}/notifications/gateway:${GATEWAY_TAG}"
echo "    email-service image: ${REGISTRY}/notifications/email-service:${EMAIL_TAG}"

helm upgrade "$RELEASE" "$CHART" \
  --install \
  --create-namespace \
  --namespace "$NAMESPACE" \
  --wait \
  --timeout 5m \
  --set "gateway.image.repository=${REGISTRY}/notifications/gateway" \
  --set "gateway.image.tag=${GATEWAY_TAG}" \
  --set "gateway.image.pullPolicy=Always" \
  --set "emailService.image.repository=${REGISTRY}/notifications/email-service" \
  --set "emailService.image.tag=${EMAIL_TAG}" \
  --set "emailService.image.pullPolicy=Always" \
  "$@"

echo ""
echo "All resources ready."
echo ""
echo "Access points (add to /etc/hosts if using ingress):"
echo "  Gateway API : http://notifications.local/notifications/email"
echo "  MailHog UI  : http://<node-ip>:<mailhog-nodeport>"
echo ""
echo "Get MailHog NodePort:"
echo "  kubectl get svc mailhog -n $NAMESPACE"
