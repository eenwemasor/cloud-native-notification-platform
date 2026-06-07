#!/usr/bin/env bash
# deploy-local.sh — apply all manifests to a running minikube cluster
#
# Prerequisites:
#   brew install minikube kubectl
#   minikube start --memory=4096 --cpus=2
#   minikube addons enable ingress
#
# Build images into minikube's Docker daemon:
#   eval $(minikube docker-env)
#   docker build -t notifications/gateway:latest -f services/gateway/Dockerfile .
#   docker build -t notifications/email-service:latest -f services/email-service/Dockerfile .
set -euo pipefail

NAMESPACE=notifications

echo "==> Applying namespace"
kubectl apply -f k8s/namespace.yaml

echo "==> Deploying Kafka stack (KRaft — no Zookeeper)"
kubectl apply -f k8s/kafka/kafka.yaml
kubectl apply -f k8s/kafka/schema-registry.yaml

echo "==> Waiting for Kafka to be ready..."
kubectl rollout status deployment/kafka -n $NAMESPACE --timeout=180s
kubectl rollout status deployment/schema-registry -n $NAMESPACE --timeout=120s

echo "==> Deploying MailHog"
kubectl apply -f k8s/email-service/mailhog.yaml

echo "==> Deploying services"
kubectl apply -f k8s/gateway/configmap.yaml
kubectl apply -f k8s/gateway/deployment.yaml
kubectl apply -f k8s/gateway/service.yaml
kubectl apply -f k8s/gateway/ingress.yaml

kubectl apply -f k8s/email-service/configmap.yaml
kubectl apply -f k8s/email-service/deployment.yaml

echo "==> Waiting for services to be ready..."
kubectl rollout status deployment/gateway -n $NAMESPACE --timeout=120s
kubectl rollout status deployment/email-service -n $NAMESPACE --timeout=120s

echo ""
echo "✓ All deployments ready"
echo ""
echo "Access points:"
echo "  Gateway API:   http://notifications.local/notifications/email"
echo "  MailHog UI:    $(minikube service mailhog --url -n $NAMESPACE | grep 8025)"
echo ""
echo "Add to /etc/hosts:"
echo "  $(minikube ip)  notifications.local"
