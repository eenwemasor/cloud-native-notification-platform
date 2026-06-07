# Agent Handoff — Cloud-Native Notification Platform

> Read this file first. It gives you full context to continue work on this project without re-exploring the codebase.

---

## What this project is

A **learning project** demonstrating cloud-native concepts end-to-end:

- Kafka as a message broker (KRaft mode — no Zookeeper)

- Avro schemas + Schema Registry for type-safe events

- Two TypeScript microservices (gateway, email-service) in a monorepo

- Docker Compose for local dev, Kubernetes manifests for local cluster deployment

Working directory: `/Users/Barnabasenwemasor/Workspace/learn/cloud-native-notification-platform`

---

## File structurea

```

.

├── docker-compose.yml              ← Full local dev stack (run this first)

├── package.json                    ← npm workspaces root

├── tsconfig.base.json              ← Shared TS compiler options

│

├── packages/

│   └── schemas/                    ← Shared Avro schemas + generated TS types

│       ├── src/avro/

│       │   ├── email-notification.avsc   ← EmailNotification Avro schema

│       │   └── notification-status.avsc  ← NotificationStatus Avro schema

│       ├── src/generated/

│       │   ├── EmailNotification.ts      ← Auto-generated TS interface

│       │   └── NotificationStatus.ts    ← Auto-generated TS interface

│       ├── src/index.ts            ← Package exports

│       ├── src/topics.ts           ← Kafka topic name constants

│       └── scripts/generate-types.ts  ← Avro → TS code generator

│

├── services/

│   ├── gateway/                    ← REST API → Kafka producer

│   │   ├── Dockerfile              ← Multi-stage build

│   │   └── src/

│   │       ├── index.ts            ← Entrypoint, startup, graceful shutdown

│   │       ├── app.ts              ← Express app factory

│   │       ├── config.ts           ← Env-var config

│   │       ├── kafka/

│   │       │   ├── producer.ts     ← NotificationProducer (at-least-once + exactly-once)

│   │       │   └── topics.ts       ← Topic names + ensureTopics() admin helper

│   │       ├── routes/

│   │       │   └── notifications.ts  ← POST /notifications/email

│   │       └── middleware/

│   │           └── validate.ts     ← Zod schema validation middleware

│   │

│   └── email-service/              ← Kafka consumer → Nodemailer

│       ├── Dockerfile

│       └── src/

│           ├── index.ts            ← Entrypoint + graceful shutdown

│           ├── config.ts           ← Env-var config

│           ├── kafka/

│           │   └── consumer.ts     ← EmailConsumer (manual offset commit, dedup)

│           └── email/

│               ├── sender.ts       ← EmailSender via Nodemailer

│               └── templates.ts    ← Simple {{key}} template renderer

│

└── k8s/                            ← Kubernetes manifests (minikube target)

    ├── namespace.yaml

    ├── deploy-local.sh             ← One-shot deploy script

    ├── kafka/

    │   ├── kafka.yaml              ← Kafka KRaft Deployment + Service

    │   └── schema-registry.yaml   ← Schema Registry Deployment + Service

    ├── gateway/

    │   ├── configmap.yaml

    │   ├── deployment.yaml         ← 2 replicas, rolling update, readiness probe

    │   ├── service.yaml

    │   └── ingress.yaml            ← nginx ingress → notifications.local

    └── email-service/

        ├── configmap.yaml

        ├── deployment.yaml         ← 2 replicas, 60s termination grace period

        └── mailhog.yaml            ← MailHog Deployment + NodePort Service

```

---

## Infrastructure images (current)

| Service | Image |

|---|---|

| Kafka | `apache/kafka-native:latest` — KRaft, no Zookeeper |

| Kafka UI | `ghcr.io/kafbat/kafka-ui:main` |

| Schema Registry | `confluentinc/cp-schema-registry:7.6.0` |

| MailHog | `mailhog/mailhog:v1.0.1` |

**Zookeeper is gone.** Kafka runs in KRaft combined mode (`KAFKA_PROCESS_ROLES=broker,controller`).

---

## Key design decisions already made

### 1. Delivery semantics — `services/gateway/src/kafka/producer.ts`

`NotificationProducer` supports two modes via constructor argument:

- **`at-least-once`** (default): `acks: -1`, no transactions. Duplicates possible on retry — consumer deduplicates on `notification.id`.

- **`exactly-once`**: `idempotent: true` + `transactionalId` + Kafka transactions. Higher latency; requires `read_committed` isolation on consumers.

### 2. Consumer offset management — `services/email-service/src/kafka/consumer.ts`

`autoCommit: false`. Offset only advances after `sendMail()` resolves. On SMTP failure the offset is NOT committed so Kafka re-delivers. In-process dedup via `seenIds: Set<string>` on `notification.id`.

### 3. Avro wire format

Gateway registers schemas on startup via `registry.register()`. Each message carries a 5-byte prefix (magic byte + schema ID). Consumer calls `registry.decode(buffer)` — no schema needed at call site.

### 4. Topic partitioning

Topics created with 3 partitions. Messages keyed by `notification.to` (recipient email) so all messages to the same address land in the same partition → ordering guarantee per recipient.

### 5. Monorepo wiring

npm workspaces. `@notifications/schemas` is a local package referenced via `"*"` version in service `package.json`. tsconfig paths alias `@notifications/schemas` → `../../packages/schemas/src/index.ts` for in-source dev without building first.

---

## How to run locally

```bash

# Install all workspace deps

npm install



# Start the full stack

docker-compose up --build



# Or start only infra (no services), useful when running services with ts-node

npm run dev:infra

```

**Endpoints once up:**

| URL | What |

|---|---|

| `http://localhost:3000/health` | Gateway health check |

| `http://localhost:3000/notifications/email` | POST — send a notification |

| `http://localhost:8080` | Kafbat Kafka UI |

| `http://localhost:8081/subjects` | Schema Registry subjects |

| `http://localhost:8025` | MailHog web UI (view sent emails) |

**Test the happy path:**

```bash

curl -X POST http://localhost:3000/notifications/email \

  -H "Content-Type: application/json" \

  -d '{

    "to": "user@example.com",

    "subject": "Hello from the platform",

    "body": "Your notification arrived"

  }'

# → 202 { "id": "...", "status": "queued" }

# Check MailHog at http://localhost:8025

```

**Regenerate TypeScript types from Avro schemas:**

```bash

npm run generate:types

```

---

## How to deploy to local Kubernetes (minikube)

```bash

minikube start --memory=4096 --cpus=2

minikube addons enable ingress



# Build images into minikube's Docker daemon

eval $(minikube docker-env)

docker build -t notifications/gateway:latest -f services/gateway/Dockerfile .

docker build -t notifications/email-service:latest -f services/email-service/Dockerfile .



# Apply all manifests in dependency order

./k8s/deploy-local.sh



# Add to /etc/hosts

echo "$(minikube ip)  notifications.local" | sudo tee -a /etc/hosts

```

---

## What has NOT been built yet (known gaps)

- No `notifications.status` topic consumer — status events are produced to the topic but nothing reads them

- No persistent deduplication store — `seenIds` is in-memory and resets on restart

- No authentication on the gateway API

- No SMS or push notification microservices (only email exists)

- No Helm chart (raw manifests only)

- Tests — no unit or integration tests written yet
