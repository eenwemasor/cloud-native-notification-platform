#!/usr/bin/env bash
# deploy-local.sh — apply all manifests to a running minikube cluster
#
# Run from the repo root:
#   ./infrastructure/k8s/deploy-local.sh
#
# Prerequisites:
#   minikube start --memory=4096 --cpus=2
#   minikube addons enable ingress
#
# Build images into minikube's Docker daemon first:
#   eval $(minikube docker-env)
#   docker build -t notifications/gateway:latest gateway/
#   docker build -t notifications/email-service:latest email-service/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE=notifications

echo "==> Applying namespace"
kubectl apply -f "$SCRIPT_DIR/namespace.yaml"

echo "==> Deploying Kafka stack (KRaft — no Zookeeper)"
kubectl apply -f "$SCRIPT_DIR/kafka/kafka.yaml"
kubectl apply -f "$SCRIPT_DIR/kafka/schema-registry.yaml"

echo "==> Waiting for Kafka to be ready..."
kubectl rollout status deployment/kafka -n $NAMESPACE --timeout=180s
kubectl rollout status deployment/schema-registry -n $NAMESPACE --timeout=120s

echo "==> Deploying MailHog"
kubectl apply -f "$SCRIPT_DIR/email-service/mailhog.yaml"

echo "==> Deploying services"
kubectl apply -f "$SCRIPT_DIR/gateway/configmap.yaml"
kubectl apply -f "$SCRIPT_DIR/gateway/deployment.yaml"
kubectl apply -f "$SCRIPT_DIR/gateway/service.yaml"
kubectl apply -f "$SCRIPT_DIR/gateway/ingress.yaml"

kubectl apply -f "$SCRIPT_DIR/email-service/configmap.yaml"
kubectl apply -f "$SCRIPT_DIR/email-service/deployment.yaml"

echo "==> Waiting for services to be ready..."
kubectl rollout status deployment/gateway -n $NAMESPACE --timeout=120s
kubectl rollout status deployment/email-service -n $NAMESPACE --timeout=120s

echo ""
echo "All deployments ready"
echo ""
echo "Access points:"
echo "  Gateway API:   http://notifications.local/notifications/email"
echo "  MailHog UI:    $(minikube service mailhog --url -n $NAMESPACE | grep 8025)"
echo ""
echo "Add to /etc/hosts:"
echo "  $(minikube ip)  notifications.local"
