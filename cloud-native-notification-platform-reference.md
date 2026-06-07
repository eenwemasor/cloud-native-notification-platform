# Cloud-Native Notification Platform — Research & Build Reference

*A production-grade, event-driven system for reliable, scalable, observable delivery of Email, SMS, and Push notifications.*

**Last updated:** June 2026 · Pricing figures are US-region and verified mid-2026; always re-check provider pages before committing.

---

## Table of Contents

1. [What It Is](#1-what-it-is)
2. [How to Build It](#2-how-to-build-it)
3. [Tools Required](#3-tools-required)
4. [Cost Analysis](#4-cost-analysis)
5. [Sources](#sources)

---

## 1. What It Is

A cloud-native notification platform accepts a request like *"notify user X about event Y"* and reliably delivers that message across one or more channels (email, SMS, push), while surviving provider outages, traffic spikes, and partial failures. "Cloud-native" means it is built from loosely-coupled, independently-scalable components running in containers, communicating **asynchronously** through queues rather than direct calls.

### Defining characteristics

**Event-driven and decoupled.** The component producing the notification (your app) never talks directly to the component delivering it (the email/SMS sender). A message queue sits between them. This is the single most important design idea — it lets producers and consumers scale, fail, and deploy independently. If your SMS provider is down, messages accumulate in a queue instead of crashing the caller.

**Multi-channel with fan-out.** One logical event ("order shipped") may need to go out as email *and* push *and* SMS. A publish/subscribe layer "fans out" one published event to multiple channel-specific consumers.

**Resilient by design.** Delivery to third parties fails constantly (rate limits, timeouts, bounced addresses). The platform must:
- Retry intelligently (exponential backoff with jitter)
- Give up gracefully after N attempts
- Route permanently-failed messages to a **dead-letter queue (DLQ)** for inspection rather than losing them

**Idempotent.** Because "at-least-once" delivery is the norm in distributed systems, the same message may be processed more than once. The platform must deduplicate (via an idempotency key) so a user doesn't receive the same SMS five times.

**Observable.** You need to answer *"did this notification actually get delivered, and if not, why?"* — which requires metrics (throughput, error rates, queue depth), structured logs, and distributed traces that follow a single message end-to-end.

### Skills this project exercises

| Pillar | What you learn |
|---|---|
| Message Queues & Async Architecture | Producer/consumer decoupling, pub/sub fan-out, ordering, exactly-once vs at-least-once |
| Containerization & Orchestration | Docker packaging, Kubernetes deployment, per-channel worker isolation |
| Scalability Under Load | Horizontal scaling, queue-depth-based autoscaling, load testing |
| Retry Logic & Failure Handling | Backoff strategies, DLQs, visibility timeouts, idempotency |
| Observability | Metrics, logs, traces, dashboards, alerting |

---

## 2. How to Build It

### Reference architecture

```
                +------------------+
   Clients ---> |   API / Ingest   |  (stateless, validates, assigns
                |     service      |   idempotency key, returns 202)
                +--------+---------+
                         |
                    publish event
                         v
                +------------------+
                |  Pub/Sub layer   |  (fan-out: one event -> many channels,
                |  + Routing svc   |   applies user prefs / opt-outs)
                +----+----+----+---+
                     |    |    |
            +--------+    |    +--------+
            v             v             v
      +-----------+ +-----------+ +-----------+
      | Email Q   | | Push Q    | | SMS Q     |   (one queue per channel)
      +-----+-----+ +-----+-----+ +-----+-----+
            |             |             |
            v             v             v
      +-----------+ +-----------+ +-----------+
      | Email     | | Push      | | SMS       |   (independent containerized
      | Worker    | | Worker    | | Worker    |    consumers, each autoscaled)
      +-----+-----+ +-----+-----+ +-----+-----+
            |             |             |
      +-----v----+  +-----v----+  +-----v----+
      |  SES     |  |  FCM     |  |  Twilio  |   (channel providers)
      +----------+  +----------+  +----------+
            \            |             /
             \           v            /
            +------------------------+
            | Status DB + Metrics +  |  (delivery tracking, webhooks for
            | DLQ for failed msgs    |   bounces/receipts, observability)
            +------------------------+
```

### Request flow

`API → publish event → fan-out to channel queues → workers consume → render template → call provider → record status → emit metrics`

The API returns `202 Accepted` immediately after enqueueing; it never blocks on delivery.

### Incremental build plan

Each phase earns its complexity — resist building everything at once.

**Phase 1 — Prove the async pattern (MVP).** One channel (email), a single queue, one worker, no orchestration. Run it with Docker Compose. Goal: a request lands in a queue and a worker picks it up and sends an email.

**Phase 2 — Fan-out + second channel.** Add the pub/sub layer and a push worker (FCM is free, so it's cheap to test). Goal: one event triggers two channels.

**Phase 3 — Orchestration + resilience.** Move to Kubernetes. Add retries with exponential backoff, DLQs, visibility timeouts, and idempotency (Redis keys with TTL). Goal: kill a worker mid-process and lose nothing.

**Phase 4 — Autoscaling + observability.** Add KEDA to scale workers on queue depth (scale to zero when idle, burst under load). Instrument everything with OpenTelemetry → Prometheus/Grafana/Loki/Tempo. Goal: a dashboard showing throughput, error rate, and queue lag, with alerts.

**Phase 5 — SMS + hardening.** Add the SMS channel (real money — guard it), rate limiting, and a load test that drives autoscaling. Goal: sustained load handled gracefully with cost controls.

### Key design decisions

| Decision | Recommended approach |
|---|---|
| Queue technology | Managed (SNS+SQS) for cloud integration; self-hosted (RabbitMQ/Kafka) to learn internals |
| Retry strategy | Exponential backoff with jitter, capped at ~5 attempts, then DLQ |
| Stuck-message detection | Queue visibility timeouts; redrive policy to DLQ |
| Idempotency | Idempotency key in Redis with a TTL window |
| Autoscaling signal | **Queue depth / consumer lag** (via KEDA) — far better than CPU for this workload |
| Channel isolation | Separate queue + worker per channel so a slow provider can't block others |

---

## 3. Tools Required

### Application layer
Any language with strong async/concurrency support — **Go** (popular for lightweight high-throughput workers), **Java/Spring Boot**, **Node.js**, or **Python/FastAPI**.

### Messaging (the heart of the system)
- **Managed:** AWS SNS (pub/sub fan-out) + SQS (queues) is the canonical pairing. GCP Pub/Sub or Azure Service Bus are equivalents.
- **Self-hosted:** RabbitMQ (simpler; great for queues + routing) or Apache Kafka (higher throughput, durable log, supports event replay; better at very high scale).
- *For an "infrastructure-dense" learning project, self-hosting Kafka or RabbitMQ teaches more internals; managed SNS/SQS teaches cloud integration.*

### Channel providers
- **Email:** Amazon SES (cheapest at scale) or SendGrid / Mailgun / Postmark (more features, higher price).
- **SMS:** Twilio (broadest reach) or Amazon SNS SMS / Vonage.
- **Push:** Firebase Cloud Messaging (FCM) — de facto standard for Android/iOS/web, and free.

### Containerization & orchestration
- **Docker** for packaging.
- **Kubernetes** for orchestration — managed via EKS / GKE / AKS, or local via kind / k3s / minikube for development.

### Autoscaling
- **Kubernetes HPA** for CPU/memory-based scaling.
- **KEDA** (Kubernetes Event-Driven Autoscaler) for scaling workers on **queue depth** — the tool that enables "scale to zero when idle, burst under load."

### Observability
- **Open-source LGTM stack:** Prometheus (metrics), Grafana (dashboards), Loki (logs), Tempo (traces).
- **OpenTelemetry** as the vendor-neutral instrumentation layer — now the industry standard, so you can switch backends without changing app code.
- **Managed alternatives:** Datadog, Grafana Cloud, New Relic.

### Supporting infrastructure
- **Redis** — idempotency keys, rate limiting, caching.
- **PostgreSQL** — notification status and audit trail.
- **Terraform / Pulumi** — infrastructure-as-code.
- **GitHub Actions / ArgoCD** — CI/CD and GitOps.

---

## 4. Cost Analysis

Two cost categories dominate: **per-message delivery fees** (variable, channel-dependent) and **infrastructure** (mostly fixed).

### Current pricing landscape (US, mid-2026)

| Item | Cost | Notes |
|---|---|---|
| **SES (email)** | $0.10 per 1,000 emails ($0.0001 each) | +$0.12/GB for attachment data; dedicated IP $24.95/mo |
| SES free tier | Accounts after Jul 15 2025: $200 in credits. Older accounts: 3,000/mo free for 12 months | Replaced the old 62K/mo EC2 tier |
| **Twilio SMS (US)** | ~$0.0079–$0.0083 per segment | + A2P 10DLC carrier fees ~$0.003–$0.005/msg; ~$1.15/mo per local number |
| **FCM (push)** | Free, unlimited | Cheapest channel by far |
| **SNS (pub/sub)** | ~$0.50 per million publishes after free tier | Delivery to SQS/Lambda is free; ~1M publishes/mo free tier |
| **SQS (queues)** | $0.40/M requests (Standard); $0.50/M (FIFO) | Permanent 1M req/mo free tier; billed per 64KB chunk |
| **EKS control plane** | $0.10/hr (~$73/mo) per cluster, flat | Jumps to $0.60/hr (~$438/mo) outside standard support |
| **GKE control plane** | $0.10/hr, with a $74.40/mo credit per billing account | Effectively free for one small zonal cluster |
| **AKS control plane** | Free on standard tier | Premium/SLA tier is $0.60/hr |
| **Observability** | Open-source = free software (pay compute + ops) | Managed Datadog ~$500–2k/mo for a small team, much more at scale |

### Worked example — 1M notifications/month

Split as 700K email, 200K push, 100K SMS:

| Component | Monthly cost | Notes |
|---|---|---|
| Email (SES) | ~$70 | 700K × $0.0001 |
| Push (FCM) | $0 | Free |
| SMS (Twilio) | ~$1,200 | 100K × (~$0.008 + ~$0.004 A2P fees) |
| Queues (SNS + SQS) | ~$1–5 | Mostly inside free tiers |
| Infrastructure | ~$165–220 | 1 small EKS cluster ($73) + ~3 small nodes; near-free on GKE zonal credit |
| Observability | $0–100 | Self-hosted on cluster ≈ marginal; managed entry tier otherwise |
| **Total** | **~$1,450–1,600** | **~80% is SMS** |

### The key cost insight

**SMS dominates variable cost; email is nearly free; push is free; infrastructure is a relatively fixed ~$150–250 floor.**

The expensive surprises in cloud-native systems are rarely the headline fees — they're **NAT gateways, cross-zone traffic, observability ingestion, and idle load balancers**. The Kubernetes control plane is typically **under 5% of total cluster spend** — compute (nodes) is the bulk.

### Cost-optimization levers

- Prefer FCM/email over SMS wherever the use case allows.
- Use **KEDA to scale workers to zero** when there are no messages.
- Run a **single small cluster** — control-plane fees are charged per cluster.
- Use **spot/preemptible nodes** for stateless workers.
- **Self-host observability** while learning instead of paying per-host SaaS fees.
- Stay current on **Kubernetes versions** to avoid the extended-support penalty (the ~6x EKS jump).

---

## Sources

Pricing verified mid-2026 against:
- AWS SNS, SQS, SES, and EKS official pricing pages and 2026 pricing-analysis guides (Cloud Burn, Sedai, LeanOps)
- Twilio US SMS pricing pages and 2026 cost guides (Vendr, TextUs, CostBench)
- Firebase / FCM pricing (Google Firebase pricing page; confirmed free, unlimited)
- Managed Kubernetes comparisons (CloudOptimo, Sedai, LeanOps, DEV Community — EKS vs GKE vs AKS, 2026)
- Observability cost comparisons (Datadog vs Grafana/Prometheus, OpenTelemetry; 2026 guides)

> Prices change frequently and vary by region and volume tier. Treat these as planning baselines and confirm against live provider pricing pages before budgeting.
