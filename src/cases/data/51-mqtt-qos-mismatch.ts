import { DetectiveCase } from '../../types';

export const mqttQosMismatch: DetectiveCase = {
  id: 'mqtt-qos-mismatch',
  title: 'The MQTT QoS Mismatch',
  subtitle: 'Messages lost due to QoS level mismatch between publisher and subscriber',
  difficulty: 'mid',
  category: 'networking',

  crisis: {
    description: `
      Your IoT fleet management system uses MQTT for vehicle telemetry. Vehicles publish
      GPS coordinates every 10 seconds. The fleet monitoring dashboard is showing gaps
      in vehicle tracks - some position updates are missing, making it appear vehicles
      are "teleporting" across the map.
    `,
    impact: `
      30% of GPS updates missing from dashboard. Fleet managers cannot track vehicles
      accurately. Route optimization broken due to incomplete data. Customer SLA
      violations for tracking accuracy.
    `,
    timeline: [
      { time: 'Day 1', event: 'New high-performance subscriber deployed', type: 'normal' },
      { time: 'Day 2', event: 'First reports of "jumping" vehicles on map', type: 'warning' },
      { time: 'Day 3', event: 'Gaps confirmed in position database', type: 'warning' },
      { time: 'Day 5', event: 'Missing data reaches 30% of updates', type: 'critical' },
      { time: 'Day 6', event: 'Customer complaints escalating', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'MQTT broker is healthy and accepting connections',
      'Vehicles are publishing messages (confirmed by broker stats)',
      'Subscriber is receiving some messages',
      'Network connectivity is stable',
      'No errors in broker or subscriber logs'
    ],
    broken: [
      '30% of position updates missing in database',
      'Vehicle tracks have gaps (teleporting effect)',
      'Subscriber message rate lower than publisher rate',
      'No message loss in staging environment',
      'Packet captures show messages leaving vehicles'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'MQTT Broker Statistics',
      type: 'metrics',
      content: `
## Broker Stats (mosquitto)

| Metric | Value |
|--------|-------|
| Messages Published (last hour) | 432,000 |
| Messages Delivered (last hour) | 302,400 |
| Message Delivery Ratio | **70%** |
| Connected Publishers | 1,200 vehicles |
| Connected Subscribers | 3 |

## Per-Topic Stats: vehicles/+/position
| Direction | Count | QoS Distribution |
|-----------|-------|------------------|
| Published | 432,000 | QoS 1: 100% |
| Delivered | 302,400 | QoS 0: 100% |

Note: Published at QoS 1, Delivered at QoS 0
      `,
      hint: 'QoS changes between publish and delivery'
    },
    {
      id: 2,
      title: 'Vehicle Publisher Code',
      type: 'code',
      content: `
\`\`\`python
# vehicle_tracker.py (runs on each vehicle)

import paho.mqtt.client as mqtt
import json

client = mqtt.Client(client_id=f"vehicle-{VEHICLE_ID}")
client.connect(BROKER_HOST, 1883, 60)

def publish_position(lat, lon, speed, heading):
    topic = f"vehicles/{VEHICLE_ID}/position"
    payload = json.dumps({
        "lat": lat,
        "lon": lon,
        "speed": speed,
        "heading": heading,
        "timestamp": time.time()
    })

    # QoS 1 = At least once delivery
    # Broker acknowledges receipt with PUBACK
    result = client.publish(topic, payload, qos=1, retain=False)

    if result.rc != mqtt.MQTT_ERR_SUCCESS:
        logger.error(f"Publish failed: {result.rc}")

# Publish every 10 seconds
while True:
    pos = get_gps_position()
    publish_position(pos.lat, pos.lon, pos.speed, pos.heading)
    time.sleep(10)
\`\`\`
      `,
      hint: 'Publisher is using QoS 1 (at least once)'
    },
    {
      id: 3,
      title: 'Dashboard Subscriber Code',
      type: 'code',
      content: `
\`\`\`javascript
// subscriber.js (new high-performance version)

const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://broker:1883', {
  clientId: 'dashboard-subscriber',
  clean: true,  // Clean session - no persistent subscriptions
});

client.on('connect', () => {
  // Subscribe to all vehicle positions
  // NOTE: Developer thought QoS 0 would be "faster"
  client.subscribe('vehicles/+/position', { qos: 0 }, (err) => {
    if (err) console.error('Subscribe failed:', err);
  });
});

client.on('message', (topic, payload) => {
  const position = JSON.parse(payload.toString());
  saveToDatabase(topic, position);
  updateDashboard(topic, position);
});
\`\`\`
      `,
      hint: 'Subscriber is using QoS 0 (at most once)'
    },
    {
      id: 4,
      title: 'MQTT QoS Level Documentation',
      type: 'config',
      content: `
\`\`\`
## MQTT Quality of Service Levels

QoS 0 - At most once ("Fire and forget")
  - Message delivered at most once, may be lost
  - No acknowledgment from broker
  - Fastest, lowest overhead
  - Use for: non-critical data, frequent updates where loss is OK

QoS 1 - At least once
  - Message delivered at least once, may be duplicated
  - Broker sends PUBACK acknowledgment
  - Use for: important messages where duplicates can be handled

QoS 2 - Exactly once
  - Message delivered exactly once (4-step handshake)
  - Highest overhead, slowest
  - Use for: critical transactions

## CRITICAL: QoS Downgrade Rule

The ACTUAL delivery QoS = MIN(publisher_qos, subscriber_qos)

Publisher QoS 1 + Subscriber QoS 0 = Delivery at QoS 0
Publisher QoS 2 + Subscriber QoS 1 = Delivery at QoS 1

The subscriber's QoS is a MAXIMUM, not a guarantee!
\`\`\`
      `,
      hint: 'MQTT uses the minimum QoS of publisher and subscriber'
    },
    {
      id: 5,
      title: 'Network Conditions',
      type: 'metrics',
      content: `
## Network Stats (Broker to Subscriber)

| Metric | Value |
|--------|-------|
| Latency | 15ms avg |
| Packet Loss | **0.5%** |
| Bandwidth | Adequate (50Mbps available) |
| TCP Retransmits | 0.1% |

## Staging vs Production

| Environment | Packet Loss | Message Loss |
|-------------|-------------|--------------|
| Staging | 0% | 0% |
| Production | 0.5% | **30%** |

Note: Staging has direct LAN connection
Production goes through load balancer and multiple hops
      `,
      hint: 'Even small packet loss is amplified with QoS 0'
    },
    {
      id: 6,
      title: 'Backend Developer Testimony',
      type: 'testimony',
      content: `
> "I rewrote the subscriber for better performance. The old version used
> QoS 1 but it felt slow - every message needed an acknowledgment."
>
> "I switched to QoS 0 thinking it would be faster. The messages are
> small and we send them frequently, so I figured losing one occasionally
> would be fine."
>
> "In our staging tests, message delivery was 100%. I didn't realize
> production network had any packet loss."
>
> "Looking at the MQTT spec now, I see that the subscriber's QoS doesn't
> raise the delivery guarantee - it only lowers it. I assumed QoS 1
> publish would mean QoS 1 delivery regardless of subscriber settings."
>
> — Sam, Backend Developer
      `,
      hint: 'The developer misunderstood MQTT QoS semantics'
    }
  ],

  solution: {
    diagnosis: 'Subscriber QoS 0 downgrading publisher QoS 1 to at-most-once delivery, amplifying network packet loss',

    keywords: [
      'qos', 'mqtt', 'at most once', 'at least once', 'message loss', 'downgrade',
      'subscriber', 'publisher', 'packet loss', 'puback', 'quality of service'
    ],

    rootCause: `
      MQTT has a critical QoS rule: the actual delivery quality is the MINIMUM of the
      publisher's QoS and the subscriber's QoS. This is a common source of confusion.

      The sequence of events:
      1. Vehicles publish at QoS 1 (at least once) - broker acknowledges receipt
      2. Broker receives message and stores it for delivery
      3. Subscriber subscribed with QoS 0 (at most once)
      4. Broker downgrades delivery to QoS 0 - no delivery acknowledgment
      5. Any packet loss between broker and subscriber = lost message

      With 0.5% packet loss and no retransmission (QoS 0):
      - TCP handles some retransmits, but not all
      - MQTT-level loss compounds with application-level effects
      - Subscriber connection hiccups cause additional losses
      - Result: 30% message loss in practice

      The old subscriber used QoS 1, which meant:
      - Broker waits for subscriber acknowledgment (PUBACK)
      - If no PUBACK, broker retransmits
      - Network packet loss was automatically recovered

      QoS 0 is only appropriate when the subscriber can tolerate loss AND has a
      low-loss connection to the broker.
    `,

    codeExamples: [
      {
        lang: 'javascript',
        description: 'Fixed subscriber with QoS 1',
        code: `const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://broker:1883', {
  clientId: 'dashboard-subscriber',
  clean: false,  // Persistent session - broker remembers subscriptions

  // Enable automatic reconnect
  reconnectPeriod: 1000,

  // Keep alive for connection health
  keepalive: 30,
});

client.on('connect', () => {
  // Subscribe with QoS 1 to match publisher's QoS
  // Now delivery will be "at least once"
  client.subscribe('vehicles/+/position', { qos: 1 }, (err, granted) => {
    if (err) {
      console.error('Subscribe failed:', err);
      return;
    }

    // Verify granted QoS matches requested
    granted.forEach(sub => {
      if (sub.qos !== 1) {
        console.warn(\`Granted QoS \${sub.qos} differs from requested 1\`);
      }
    });
  });
});

client.on('message', (topic, payload, packet) => {
  const position = JSON.parse(payload.toString());

  // Handle potential duplicates (QoS 1 may deliver more than once)
  const messageId = \`\${topic}:\${position.timestamp}\`;

  if (!isDuplicate(messageId)) {
    saveToDatabase(topic, position);
    updateDashboard(topic, position);
    markProcessed(messageId);
  }
});`
      },
      {
        lang: 'python',
        description: 'Publisher with confirmation and retry',
        code: `import paho.mqtt.client as mqtt
from collections import deque
import time

class ReliablePublisher:
    def __init__(self, broker_host, vehicle_id):
        self.pending_messages = {}  # mid -> message
        self.client = mqtt.Client(client_id=f"vehicle-{vehicle_id}")

        # Handle publish acknowledgments
        self.client.on_publish = self._on_publish
        self.client.on_disconnect = self._on_disconnect

        self.client.connect(broker_host, 1883, 60)
        self.client.loop_start()

    def _on_publish(self, client, userdata, mid):
        # Message acknowledged by broker
        if mid in self.pending_messages:
            del self.pending_messages[mid]

    def _on_disconnect(self, client, userdata, rc):
        # On disconnect, messages in pending_messages need retry
        # paho handles this automatically with QoS 1

    def publish_position(self, lat, lon, speed, heading):
        topic = f"vehicles/{self.vehicle_id}/position"
        payload = json.dumps({
            "lat": lat,
            "lon": lon,
            "speed": speed,
            "heading": heading,
            "timestamp": time.time()
        })

        # QoS 1 with message tracking
        result = self.client.publish(topic, payload, qos=1)

        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            self.pending_messages[result.mid] = {
                'topic': topic,
                'payload': payload,
                'time': time.time()
            }
        else:
            # Queue for retry
            self._queue_retry(topic, payload)`
      },
      {
        lang: 'yaml',
        description: 'Mosquitto broker configuration for reliable delivery',
        code: `# mosquitto.conf

# Persistence for QoS 1/2 messages
persistence true
persistence_location /var/lib/mosquitto/

# Message queue limits per client
max_inflight_messages 100
max_queued_messages 1000

# Quality of service
max_qos_level 2

# Retain last message for late subscribers
# (useful for "current position" queries)

# Logging for debugging
log_type all
log_dest file /var/log/mosquitto/mosquitto.log

# Connection limits
max_connections 5000

# Keepalive and timeout settings
keepalive_interval 60
retry_interval 20

# Allow clean session = false for persistent subscriptions
allow_zero_length_clientid false`
      }
    ],

    prevention: [
      'Always match subscriber QoS to required delivery guarantee, not performance assumptions',
      'Document QoS requirements in API contracts',
      'Monitor broker delivery ratio (published vs delivered)',
      'Test with realistic network conditions including packet loss',
      'Use QoS 1 or 2 when data loss is unacceptable',
      'Implement duplicate detection for QoS 1 (at-least-once may deliver twice)',
      'Use persistent sessions (clean: false) to survive subscriber reconnects',
      'Alert on QoS downgrades in broker logs'
    ],

    educationalInsights: [
      'MQTT delivery QoS = MIN(publisher_qos, subscriber_qos) - not MAX',
      'QoS 0 provides no guarantees and no retransmission',
      'Network packet loss is amplified with QoS 0 because theres no recovery',
      'QoS 1 adds one round-trip latency but provides delivery guarantee',
      'Staging environments often have better networks than production',
      'Clean sessions (clean: true) discard queued messages on reconnect'
    ]
  }
};
