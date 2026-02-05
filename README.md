# Backend Engineer Detective

**Solve 121 production incidents from PlayStation-scale scenarios.**

An interactive detective game where you investigate real-world backend engineering incidents. Analyze logs, metrics, code, and testimonies to diagnose root causes — with an AI mentor to guide your investigation.

### [Play Now → backend-engineer-detective.davidsyagustin.workers.dev](https://backend-engineer-detective.davidsyagustin.workers.dev)

![Theme](https://img.shields.io/badge/theme-detective%20noir-black)
![Cases](https://img.shields.io/badge/cases-121-e94560)
![Difficulty](https://img.shields.io/badge/difficulty-junior%20→%20principal-f0a500)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-F6821F)
[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://backend-engineer-detective.davidsyagustin.workers.dev)

---

## How It Works

1. **Pick a Case** — Choose from 121 incidents across 11 categories
2. **Investigate** — Examine clues progressively: error logs, metrics dashboards, code snippets, config files, and engineer testimonies
3. **Chat with Detective Claude** — Your AI mentor asks Socratic questions to guide your thinking (without giving away the answer)
4. **Submit Your Diagnosis** — Describe the root cause in your own words
5. **Learn** — Get detailed explanations, code fixes, and prevention strategies

---

## Case Categories

| Category | Cases | Topics |
|----------|-------|--------|
| **Core Backend** | 1-22 | Database pooling, caching, auth, memory, distributed systems |
| **AWS Infrastructure** | 23-32 | Lambda, S3, DynamoDB, RDS, SQS, CloudFront, ECS, ALB, SNS |
| **Databases Deep Dive** | 33-42 | PostgreSQL, MongoDB, Cassandra, MySQL, Redis Cluster, CockroachDB |
| **Message Queues** | 43-52 | RabbitMQ, Kafka, NATS, Redis Pub/Sub, Pulsar, Celery, Kinesis, Bull |
| **Kubernetes & DevOps** | 53-62 | HPA, Istio, Helm, CrashLoopBackOff, Service Mesh, PVC, Docker, ArgoCD |
| **Auth & API Design** | 63-72 | JWT, OAuth2, CORS, Rate Limiting, gRPC, REST, GraphQL, mTLS |
| **Monitoring** | 73-82 | Prometheus, Datadog, ELK, Jaeger, PagerDuty, Grafana, OpenTelemetry |
| **Language Runtimes** | 83-92 | Node.js, Java GC, Go, Python GIL, Rust async, PHP-FPM, Ruby, .NET, JVM |
| **Load Balancing** | 93-102 | Nginx, HAProxy, TCP, DNS, TLS, HTTP/2, BGP, MTU, WebSocket proxies |
| **Resilience Patterns** | 103-111 | Circuit breakers, retries, bulkheads, sagas, CQRS, idempotency, 2PC |
| **DevOps & Deployment** | 113-122 | CI/CD, blue-green, canary, migrations, feature flags, Terraform, GitOps |

---

## Difficulty Levels

| Level | Description |
|-------|-------------|
| **Junior** | Common issues with clear symptoms |
| **Mid** | Multi-component problems requiring system thinking |
| **Senior** | Complex distributed system failures |
| **Principal** | Subtle, high-impact incidents requiring deep expertise |

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Cloudflare account (for deployment)

### Local Development

```bash
# Clone the repository
git clone https://github.com/davidagustin/backend-engineer-detective.git
cd backend-engineer-detective

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:8787](http://localhost:8787) in your browser.

### Deploy to Cloudflare Workers

```bash
# Login to Cloudflare
npx wrangler login

# Deploy
npm run deploy
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (public/)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Case     │  │ Case     │  │ Chat     │  │ Solution │           │
│  │ Grid     │  │ View     │  │ Panel    │  │ Display  │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       └──────────────┴──────────────┴──────────────┘               │
│                          app.js + state.js                         │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   CLOUDFLARE WORKER (src/)                         │
│  GET  /api/cases           → List all cases                        │
│  GET  /api/cases/:id       → Get case with clues (progressive)     │
│  POST /api/cases/:id/check → Check diagnosis (LLM-evaluated)       │
│  POST /api/chat            → AI chat with case context (SSE)       │
└─────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Runtime:** Cloudflare Workers (TypeScript)
- **AI:** Workers AI (Llama 3.1 8B) with SSE streaming
- **Frontend:** Vanilla HTML/JS/CSS (no framework, no build step)
- **Styling:** Detective noir theme with Lucide icons and Prism.js syntax highlighting

---

## Project Structure

```
backend-engineer-detective/
├── public/
│   ├── index.html              # SPA shell
│   ├── styles.css              # Detective noir theme
│   ├── app.js                  # Main controller + routing
│   ├── state.js                # localStorage progress tracking
│   ├── api.js                  # API client with SSE support
│   └── components/
│       ├── case-list.js        # Case selection grid with filtering
│       ├── case-view.js        # Investigation interface
│       └── solution.js         # Solution reveal
│
├── src/
│   ├── index.ts                # Main worker with API routes
│   ├── types.ts                # TypeScript interfaces
│   ├── cases/
│   │   ├── index.ts            # Case registry (121 cases)
│   │   └── data/               # Case definition files (01-122)
│   └── utils/
│       ├── prompt-builder.ts   # AI system prompts
│       └── diagnosis-matcher.ts # LLM-based answer evaluation
│
├── wrangler.jsonc              # Cloudflare config
├── tsconfig.json               # TypeScript config
└── package.json
```

---

## API Reference

### List All Cases

```http
GET /api/cases
```

### Get Case Details

```http
GET /api/cases/:id?clues=N
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Case ID (e.g., `database-disappearing-act`) |
| `clues` | number | Number of clues to reveal (default: 2) |

### Submit Diagnosis

```http
POST /api/cases/:id/check
Content-Type: application/json

{
  "diagnosis": "connection pool exhaustion due to unreleased connections",
  "attemptCount": 1,
  "cluesRevealed": 4
}
```

Response includes:
- `isCorrect`: boolean
- `score`: number (0-100)
- `feedback`: string (LLM-generated evaluation)

### Chat with AI

```http
POST /api/chat
Content-Type: application/json

{
  "messages": [{ "role": "user", "content": "What pattern do you see?" }],
  "caseContext": { "caseId": "database-disappearing-act", "cluesRevealed": 3 }
}
```

---

## Features

### Progressive Clue Reveal
- Metrics — Dashboards, graphs, numbers
- Logs — Error messages, stack traces
- Code — Source code snippets
- Config — Configuration files
- Testimony — Engineer statements

### AI Detective Mentor
- Asks probing questions
- Points out connections between clues
- Never reveals the answer directly
- Celebrates good deductions

### Two-Phase Diagnosis
- Phase 1: Identify the root cause
- Phase 2: Explain why it happened
- LLM-evaluated scoring (0-100)

### Filtering System
- Filter by category
- Filter by difficulty
- Track solved cases

---

## Learning Outcomes

Each case teaches specific debugging skills:

| Domain | Concepts |
|--------|----------|
| **Databases** | Connection pooling, replication lag, vacuum, locking, sharding |
| **Caching** | TTL, invalidation, thundering herd, hot keys |
| **Messaging** | Backpressure, consumer lag, rebalancing, exactly-once |
| **Kubernetes** | HPA, probes, resource limits, PVC, service mesh |
| **Observability** | Cardinality, sampling, alert fatigue, trace context |
| **Networking** | DNS, TLS, load balancing, circuit breakers, timeouts |
| **Resilience** | Retries, bulkheads, sagas, idempotency, 2PC |

---

## Contributing

Contributions welcome! When adding cases:

1. Create a new file in `src/cases/data/`
2. Follow the existing case structure (title, crisis, symptoms, clues, solution)
3. Register the case in `src/cases/index.ts`
4. Test with `npm run dev`

---

## License

MIT License

---

<p align="center">
  <strong>Can you solve all 121 cases?</strong><br>
  <em>Put your debugging skills to the test.</em>
</p>
