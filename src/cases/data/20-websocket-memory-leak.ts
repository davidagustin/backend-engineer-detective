import { DetectiveCase } from '../../types';

export const websocketMemoryLeak: DetectiveCase = {
  id: 'websocket-memory-leak',
  title: 'The WebSocket Memory Drain',
  subtitle: 'Server memory grows until it crashes every 6 hours',
  difficulty: 'senior',
  category: 'memory',

  crisis: {
    description: `
      Your real-time collaboration app uses WebSockets for live document editing.
      The server memory keeps growing steadily. Every 6 hours, the server OOMs and
      restarts. Users lose their active sessions and unsaved work is gone. The problem
      started 2 weeks ago with no obvious code changes.
    `,
    impact: `
      Server crashes every 6 hours. Users lose work during restarts.
      Customer churn increased 15% due to reliability issues.
    `,
    timeline: [
      { time: '2 weeks ago', event: 'Launched new "presence" feature (see who\'s editing)', type: 'normal' },
      { time: '1 week ago', event: 'First OOM crash reported', type: 'warning' },
      { time: '3 days ago', event: 'Crashes now predictable: every 6 hours', type: 'critical' },
      { time: 'Today', event: 'Memory profiling initiated', type: 'normal' },
    ]
  },

  symptoms: {
    working: [
      'WebSocket connections work correctly',
      'Real-time updates are delivered',
      'Server handles 10K concurrent connections',
      'No memory issues immediately after restart'
    ],
    broken: [
      'Memory grows ~500MB/hour consistently',
      'OOM crash every 6 hours',
      'Memory doesn\'t decrease when users disconnect',
      'Problem correlates with presence feature launch'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Memory Usage Graph',
      type: 'metrics',
      content: `
## Server Memory Over 12 Hours

\`\`\`
Memory (GB)
4.0 |                              X (OOM)
3.5 |                           /
3.0 |                        /
2.5 |                     /
2.0 |                  /
1.5 |               /
1.0 |            /
0.5 |         /
0.0 |________/________________________________
    0h   2h   4h   6h   8h   10h  12h
         Restart here ↑

Growth rate: ~500MB/hour, linear
Baseline after restart: 400MB
\`\`\`
      `,
      hint: 'Linear growth suggests something is accumulating without being cleaned up'
    },
    {
      id: 2,
      title: 'WebSocket Connection Handler',
      type: 'code',
      content: `
\`\`\`javascript
// websocket-server.js
const connections = new Map(); // userId -> WebSocket
const presence = new Map();    // documentId -> Set<userId>

wss.on('connection', (ws, req) => {
  const userId = authenticateUser(req);
  connections.set(userId, ws);

  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.type === 'join_document') {
      // Track who's viewing each document
      if (!presence.has(msg.documentId)) {
        presence.set(msg.documentId, new Set());
      }
      presence.get(msg.documentId).add(userId);
      broadcastPresence(msg.documentId);
    }

    if (msg.type === 'leave_document') {
      presence.get(msg.documentId)?.delete(userId);
      broadcastPresence(msg.documentId);
    }
  });

  ws.on('close', () => {
    connections.delete(userId);
    // Presence cleanup happens when user sends 'leave_document'
  });
});
\`\`\`
      `,
      hint: 'What happens to presence data when a connection closes unexpectedly?'
    },
    {
      id: 3,
      title: 'Heap Snapshot Analysis',
      type: 'logs',
      content: `
\`\`\`
Heap Snapshot Comparison (2 hours apart)

Object Type              | Count Δ | Size Δ
-------------------------|---------|--------
(string)                 | +45,231 | +89 MB
Set                      | +12,456 | +24 MB
(array)                  | +8,234  | +18 MB
Map                      | +156    | +2 MB
-------------------------|---------|--------

Top Retaining Paths:
1. presence (Map) -> [documentId] (Set) -> [userId] (string)
   Retained: 89 MB across 156 documents with ~12K orphaned user entries

2. (global scope) -> eventHandlers (Array) -> (closure)
   Retained: 18 MB across 8K closures
\`\`\`
      `,
      hint: 'Presence map has "orphaned user entries" - users who disconnected but weren\'t removed'
    },
    {
      id: 4,
      title: 'Connection Statistics',
      type: 'metrics',
      content: `
## WebSocket Statistics (last 6 hours)

| Metric | Value |
|--------|-------|
| Total connections opened | 45,231 |
| Total connections closed | 44,876 |
| Clean closes (client sent goodbye) | 12,456 |
| Unclean closes (network drop, browser close) | 32,420 |
| Current active connections | 355 |

**Note:** "Unclean close" means connection dropped without client sending leave messages
      `,
      hint: '72% of disconnections are unclean - they never send "leave_document"'
    },
    {
      id: 5,
      title: 'Frontend Team Testimony',
      type: 'testimony',
      content: `
> "We send a 'leave_document' message when users click the back button or close
> the document. It's in the beforeunload handler."
>
> "But yeah, beforeunload is unreliable. If you close the laptop lid or lose
> wifi, it never fires. Same with mobile app backgrounding."
>
> — Jamie, Frontend Lead
      `,
      hint: 'The cleanup relies on a client message that often doesn\'t arrive'
    },
    {
      id: 6,
      title: 'Event Listener Inspection',
      type: 'code',
      content: `
\`\`\`javascript
// Found in message handler
ws.on('message', (data) => {
  const msg = JSON.parse(data);

  if (msg.type === 'subscribe_changes') {
    // Subscribe to document changes
    documentEvents.on(\`doc:\${msg.documentId}\`, (change) => {
      ws.send(JSON.stringify({ type: 'change', change }));
    });
  }
});

// documentEvents is an EventEmitter
// These listeners are never removed when the connection closes
\`\`\`
      `,
      hint: 'Event listeners are added but never removed'
    }
  ],

  solution: {
    diagnosis: 'WebSocket cleanup missing: presence data and event listeners not removed on unclean disconnect',

    keywords: [
      'websocket', 'memory leak', 'presence', 'cleanup', 'disconnect',
      'event listener', 'close handler', 'unclean disconnect',
      'beforeunload', 'orphaned'
    ],

    rootCause: `
      Two memory leaks are occurring:

      1. **Presence data leak**: Users are added to the presence Set when they join
         a document, but only removed when they explicitly send 'leave_document'.
         72% of connections close without sending this message (network drops,
         browser closes, mobile backgrounding), leaving orphaned entries.

      2. **Event listener leak**: When users subscribe to document changes, an
         event listener is added to documentEvents. These listeners are never
         removed on disconnect, accumulating thousands of stale closures that
         reference the closed WebSocket.

      Both leaks grow with connection churn, explaining the linear memory growth.
    `,

    codeExamples: [
      {
        lang: 'javascript',
        description: 'Fixed connection handler with proper cleanup',
        code: `wss.on('connection', (ws, req) => {
  const userId = authenticateUser(req);
  const userDocuments = new Set(); // Track docs this user joined
  const userListeners = [];        // Track event listeners to remove

  connections.set(userId, ws);

  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.type === 'join_document') {
      if (!presence.has(msg.documentId)) {
        presence.set(msg.documentId, new Set());
      }
      presence.get(msg.documentId).add(userId);
      userDocuments.add(msg.documentId); // Track it!
      broadcastPresence(msg.documentId);
    }

    if (msg.type === 'subscribe_changes') {
      const handler = (change) => ws.send(JSON.stringify({ type: 'change', change }));
      documentEvents.on(\`doc:\${msg.documentId}\`, handler);
      userListeners.push({ event: \`doc:\${msg.documentId}\`, handler }); // Track it!
    }
  });

  ws.on('close', () => {
    // Clean up connection
    connections.delete(userId);

    // Clean up ALL documents this user joined (not just explicit leaves)
    for (const docId of userDocuments) {
      presence.get(docId)?.delete(userId);
      broadcastPresence(docId);
    }

    // Clean up ALL event listeners
    for (const { event, handler } of userListeners) {
      documentEvents.off(event, handler);
    }
  });
});`
      },
      {
        lang: 'javascript',
        description: 'Alternative: Use WeakRef for automatic cleanup',
        code: `// Modern approach: WeakMap with connection reference
const connectionState = new WeakMap();

wss.on('connection', (ws, req) => {
  const userId = authenticateUser(req);
  const state = {
    userId,
    documents: new Set(),
    cleanup: new AbortController()
  };
  connectionState.set(ws, state);

  // Event listeners with AbortSignal for bulk cleanup
  documentEvents.on(\`changes\`, handleChanges, { signal: state.cleanup.signal });

  ws.on('close', () => {
    state.cleanup.abort(); // Removes all listeners at once
    // ... rest of cleanup
  });
});`
      },
      {
        lang: 'javascript',
        description: 'Heartbeat-based presence with TTL',
        code: `// Even better: don't trust client messages at all
const presenceWithTTL = new Map(); // docId -> Map<userId, lastSeen>
const PRESENCE_TTL = 30000; // 30 seconds

// Client sends heartbeat every 10 seconds
ws.on('message', (data) => {
  if (msg.type === 'heartbeat' && msg.documentId) {
    if (!presenceWithTTL.has(msg.documentId)) {
      presenceWithTTL.set(msg.documentId, new Map());
    }
    presenceWithTTL.get(msg.documentId).set(userId, Date.now());
  }
});

// Background job cleans up stale presence every 15 seconds
setInterval(() => {
  const now = Date.now();
  for (const [docId, users] of presenceWithTTL) {
    for (const [userId, lastSeen] of users) {
      if (now - lastSeen > PRESENCE_TTL) {
        users.delete(userId);
        broadcastPresence(docId);
      }
    }
  }
}, 15000);`
      }
    ],

    prevention: [
      'Always clean up on WebSocket close, not on client message',
      'Track all resources (listeners, subscriptions, data) associated with a connection',
      'Use heartbeats with TTL instead of trusting client leave messages',
      'Periodically sweep for orphaned state (defense in depth)',
      'Monitor object counts in memory, not just total memory size',
      'Load test with realistic connect/disconnect patterns'
    ],

    educationalInsights: [
      'WebSocket close events fire for all disconnections, but client messages may not',
      'beforeunload is unreliable: mobile Safari ignores it, laptops closing skip it',
      'Event listeners holding references to closures prevent garbage collection',
      'Heartbeat + TTL is more reliable than explicit leave messages',
      'WeakMap/WeakRef can help but don\'t replace explicit cleanup',
      'Memory leaks often show linear growth - each request/connection adds a fixed amount'
    ]
  }
};
