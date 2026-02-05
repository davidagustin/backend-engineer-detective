# 🔍 Backend Engineer Detective

**Solve 22 production incidents from PlayStation-scale scenarios.**

An interactive detective game where you investigate real-world backend engineering incidents. Analyze logs, metrics, code, and testimonies to diagnose root causes — with an AI mentor to guide your investigation.

### 🎮 [Play Now → backend-engineer-detective.davidsyagustin.workers.dev](https://backend-engineer-detective.davidsyagustin.workers.dev)

![Theme](https://img.shields.io/badge/theme-detective%20noir-black)
![Cases](https://img.shields.io/badge/cases-22-e94560)
![Difficulty](https://img.shields.io/badge/difficulty-junior%20→%20principal-f0a500)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-F6821F)
[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://backend-engineer-detective.davidsyagustin.workers.dev)

---

## 🎮 How It Works

1. **Pick a Case** — Choose from 22 incidents across database, caching, networking, auth, memory, and distributed systems
2. **Investigate** — Examine clues progressively: error logs, metrics dashboards, code snippets, config files, and engineer testimonies
3. **Chat with Detective Claude** — Your AI mentor asks Socratic questions to guide your thinking (without giving away the answer)
4. **Submit Your Diagnosis** — Describe the root cause in your own words
5. **Learn** — Get detailed explanations, code fixes, and prevention strategies

---

## 🗂️ The 22 Cases

| # | Case | Difficulty | Category |
|---|------|------------|----------|
| 1 | The Database Disappearing Act | Mid | Database |
| 2 | The Black Friday Disaster | Senior | Distributed |
| 3 | The Memory Explosion Mystery | Mid | Caching |
| 4 | The Ghost Users Problem | Junior | Caching |
| 5 | The Infinite Loop Incident | Senior | Auth |
| 6 | The Mysterious Memory Leak | Principal | Memory |
| 7 | The Silent Authentication Crisis | Mid | Auth |
| 8 | The Vanishing Achievements | Junior | Caching |
| 9 | The Weekend Warriors Crisis | Mid | Caching |
| 10 | The Mysterious Slow Logins | Mid | Database |
| 11 | The Phantom Friend Requests | Junior | Database |
| 12 | The Midnight Data Swap | Senior | Distributed |
| 13 | The Database Inconsistency | Mid | Database |
| 14 | The Invisible API | Junior | Networking |
| 15 | The Vanishing Multiplayer Matches | Senior | Networking |
| 16 | The Invisible Traffic Spike | Principal | Distributed |
| 17 | The Kubernetes Pod Mystery | Mid | Distributed |
| 18 | The Kafka Consumer Catastrophe | Senior | Distributed |
| 19 | The GraphQL Performance Nightmare | Mid | Database |
| 20 | The WebSocket Memory Drain | Senior | Memory |
| 21 | The Feature Flag Fiasco | Mid | Distributed |
| 22 | The Elasticsearch Indexing Storm | Senior | Distributed |

---

## 🚀 Quick Start

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

## 🏗️ Architecture

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
│  POST /api/cases/:id/check → Check diagnosis guess                 │
│  POST /api/chat            → AI chat with case context (SSE)       │
└─────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Runtime:** Cloudflare Workers (TypeScript)
- **AI:** Workers AI (Llama 3.1 8B) with SSE streaming
- **Frontend:** Vanilla HTML/JS/CSS (no framework, no build step)
- **Styling:** Detective noir theme with Prism.js syntax highlighting

---

## 📁 Project Structure

```
backend-engineer-detective/
├── public/
│   ├── index.html              # SPA shell
│   ├── styles.css              # Detective noir theme
│   ├── app.js                  # Main controller + routing
│   ├── state.js                # localStorage progress tracking
│   ├── api.js                  # API client with SSE support
│   └── components/
│       ├── case-list.js        # Case selection grid
│       ├── case-view.js        # Investigation interface
│       └── solution.js         # Solution reveal
│
├── src/
│   ├── index.ts                # Main worker with API routes
│   ├── types.ts                # TypeScript interfaces
│   ├── cases/
│   │   ├── index.ts            # Case registry
│   │   └── data/               # 16 case definition files
│   └── utils/
│       ├── prompt-builder.ts   # AI system prompts
│       └── diagnosis-matcher.ts # Fuzzy answer matching
│
├── wrangler.jsonc              # Cloudflare config
├── tsconfig.json               # TypeScript config
└── package.json
```

---

## 🔌 API Reference

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

## 🎨 Features

### Progressive Clue Reveal
- 📊 **Metrics** — Dashboards, graphs, numbers
- 📜 **Logs** — Error messages, stack traces
- 💻 **Code** — Source code snippets
- ⚙️ **Config** — Configuration files
- 💬 **Testimony** — Engineer statements

### AI Detective Mentor
- Asks probing questions
- Points out connections between clues
- Never reveals the answer directly
- Celebrates good deductions

### Progress Tracking
- Cases solved
- Clues revealed per case
- Chat history
- Attempt counts

---

## 📚 Learning Outcomes

| Concept | Cases |
|---------|-------|
| Connection pooling | #1, #10 |
| Message queue backpressure | #2 |
| Redis streams & TTL | #3, #8 |
| Presence systems & heartbeats | #4 |
| Token management | #5 |
| Native memory & fragmentation | #6 |
| Certificate chains & CDN | #7, #14 |
| Cache warming | #9 |
| SQL LIKE wildcards | #10 |
| Read-after-write consistency | #13 |
| UDP NAT traversal | #15 |
| GeoDNS & traffic routing | #16 |

---

## 🤝 Contributing

Contributions welcome! See the [wiki](../../wiki) for detailed guides on:
- [Adding New Cases](../../wiki/Adding-New-Cases)
- [API Documentation](../../wiki/API-Documentation)
- [Architecture Deep Dive](../../wiki/Architecture)

---

## 📄 License

MIT License

---

<p align="center">
  <strong>🔍 Can you solve all 16 cases?</strong><br>
  <em>Put your debugging skills to the test.</em>
</p>
