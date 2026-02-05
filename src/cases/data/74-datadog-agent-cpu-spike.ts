import { DetectiveCase } from '../../types';

export const datadogAgentCpuSpike: DetectiveCase = {
  id: 'datadog-agent-cpu-spike',
  title: 'The Datadog Agent CPU Spike',
  subtitle: 'Monitoring agent consuming 100% CPU on production hosts',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your Datadog agents are consuming 100% CPU on production hosts. Applications are
      starved for resources. The irony: your monitoring system is causing the outage
      it should be detecting. Metrics are delayed or missing, and you can't even see
      what's happening to diagnose the problem.
    `,
    impact: `
      Application response times 5x slower due to CPU starvation. 30% of hosts affected.
      Customer-facing latency SLO breached. Monitoring data delayed by 10+ minutes,
      making incident response impossible.
    `,
    timeline: [
      { time: '2:00 PM', event: 'Deploy new logging format to production', type: 'normal' },
      { time: '2:05 PM', event: 'Datadog agent CPU usage starts climbing', type: 'warning' },
      { time: '2:15 PM', event: 'First hosts hit 100% CPU on agent process', type: 'critical' },
      { time: '2:30 PM', event: '30% of fleet affected', type: 'critical' },
      { time: '2:45 PM', event: 'Application latency alerts firing (delayed)', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Application code unchanged',
      'Datadog agent process is running',
      'Network connectivity is fine',
      'Some hosts unaffected'
    ],
    broken: [
      'dd-agent process at 100% CPU',
      'Metrics delayed by 10+ minutes',
      'Log collection stalled',
      'Application performance degraded on affected hosts'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Process Analysis',
      type: 'metrics',
      content: `
\`\`\`bash
$ top -p $(pgrep -f datadog)
PID   USER   PR  NI    VIRT    RES    SHR S  %CPU %MEM     TIME+ COMMAND
18234 dd-agt 20   0  892456 234567  12340 R  99.7  2.9  45:23.12 agent
18456 dd-agt 20   0  456789 123456   8901 R  98.2  1.5  42:15.67 trace-agent
18789 dd-agt 20   0  345678  89012   6789 S  12.3  1.1   5:30.45 process-agent

$ strace -c -p 18234 -e trace=read,write
% time     seconds  usecs/call     calls    errors syscall
------ ----------- ----------- --------- --------- ----------------
 89.23    4.234567          12    352894           read
 10.77    0.511234           8     63892           write
------ ----------- ----------- --------- --------- ----------------
100.00    4.745801              416786           total

# Agent is doing massive amounts of read operations
\`\`\`
      `,
      hint: 'The agent is spending 89% of time on read operations - reading what?'
    },
    {
      id: 2,
      title: 'Datadog Agent Config',
      type: 'config',
      content: `
\`\`\`yaml
# /etc/datadog-agent/datadog.yaml
logs_enabled: true

# /etc/datadog-agent/conf.d/application.d/conf.yaml
logs:
  - type: file
    path: /var/log/application/*.log
    service: myapp
    source: nodejs

    # Custom log processing
    log_processing_rules:
      - type: multi_line
        name: multiline_logs
        pattern: '^\\[\\d{4}-\\d{2}-\\d{2}'

      - type: include_at_match
        name: include_errors
        pattern: 'ERROR|WARN|CRITICAL'

      - type: mask_sequences
        name: mask_sensitive
        pattern: '(api_key|password|secret)[=:]\\s*[^\\s]+'
        replace_placeholder: '[REDACTED]'

      - type: include_at_match
        name: extract_user_context
        pattern: 'user_id=([a-f0-9-]{36})|session=([A-Za-z0-9+/=]{32,})'
\`\`\`
      `,
      hint: 'Look at the regex patterns in log_processing_rules'
    },
    {
      id: 3,
      title: 'Log Sample (New Format)',
      type: 'logs',
      content: `
\`\`\`
# Old format (before 2:00 PM deploy):
[2024-01-15 14:00:01] INFO  Request processed user_id=abc123 duration=45ms

# New format (after 2:00 PM deploy):
[2024-01-15 14:05:01] INFO {"timestamp":"2024-01-15T14:05:01.234Z","level":"INFO",
"message":"Request processed","context":{"user_id":"abc123","session":"eyJhbGciOiJI
UzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0
IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c","trace_id":
"a]b[c{d}e(f)g*h+i?j.k^l$m|n\\o","metadata":{"nested":{"deep":{"value":"test"}}}}}

# Log volume: 50,000 lines/minute across affected hosts
# Average line length: Old=80 chars, New=850 chars
\`\`\`
      `,
      hint: 'The new log format is much longer and has unusual characters in trace_id'
    },
    {
      id: 4,
      title: 'Regex Performance Analysis',
      type: 'code',
      content: `
\`\`\`python
# Simulating the regex matching behavior
import re
import time

# The problematic pattern from config
pattern = r'user_id=([a-f0-9-]{36})|session=([A-Za-z0-9+/=]{32,})'
regex = re.compile(pattern)

# Old log line (fast)
old_line = "[2024-01-15 14:00:01] INFO  Request processed user_id=abc123 duration=45ms"
start = time.time()
for _ in range(10000):
    regex.search(old_line)
print(f"Old format: {time.time() - start:.4f}s")  # ~0.02s

# New log line with pathological input (slow)
new_line = '{"session":"eyJhbGciOiJI' + 'A' * 500 + '..."}'  # Long base64-like string
start = time.time()
for _ in range(10000):
    regex.search(new_line)
print(f"New format: {time.time() - start:.4f}s")  # ~8.5s (425x slower!)

# The [A-Za-z0-9+/=]{32,} pattern causes catastrophic backtracking
# on long strings that almost-but-not-quite match
\`\`\`
      `,
      hint: 'The session regex causes catastrophic backtracking on the new JWT-like strings'
    },
    {
      id: 5,
      title: 'Developer Testimony',
      type: 'testimony',
      content: `
> "We changed our logging to structured JSON format for better parsing. The new
> format includes the full JWT session token and a trace ID that uses special
> characters for namespacing."
>
> "We tested the new format locally and it worked fine. Logs are being written
> correctly. We didn't think changing log format would affect the monitoring agent."
>
> "Only some hosts are affected because the deploy is rolling out gradually."
>
> — Platform Team
      `,
      hint: 'The new format changed the content that regexes are matching against'
    },
    {
      id: 6,
      title: 'Regex Backtracking Explained',
      type: 'config',
      content: `
\`\`\`markdown
# Catastrophic Backtracking in Regular Expressions

## The Problem Pattern
Pattern: [A-Za-z0-9+/=]{32,}
Input: "eyJhbGciOi..." (JWT with 200+ characters)

When the regex engine tries to match and fails, it backtracks to try
different combinations. With quantifiers like {32,} on character classes,
the combinations explode exponentially.

## Time Complexity
- Normal match: O(n)
- Backtracking match: O(2^n) in worst case

## Why It Happens Here
1. JWT tokens are long strings of base64 characters
2. The pattern [A-Za-z0-9+/=]{32,} greedily matches
3. If match fails later, engine backtracks through ALL positions
4. 50,000 log lines/minute × backtracking = 100% CPU

## Safe Regex Patterns
- Use possessive quantifiers: [A-Za-z0-9+/=]{32,}+ (if supported)
- Use atomic groups: (?>[A-Za-z0-9+/=]{32,})
- Add anchors to reduce backtracking
- Set regex timeouts
- Use non-backtracking engines (RE2)
\`\`\`
      `,
      hint: 'The regex engine backtracks exponentially on near-matches'
    }
  ],

  solution: {
    diagnosis: 'Log processing regex causes catastrophic backtracking on new structured log format',

    keywords: [
      'regex', 'backtracking', 'catastrophic backtracking', 'CPU', 'datadog',
      'log processing', 'pattern', 'quantifier', 'JWT', 'session', 'agent',
      'log_processing_rules'
    ],

    rootCause: `
      The Datadog agent configuration includes log processing rules with regex patterns
      for extracting user context. One pattern - [A-Za-z0-9+/=]{32,} - is designed to
      match session tokens.

      When the logging format changed to structured JSON with full JWT tokens, this
      regex began exhibiting catastrophic backtracking:

      1. JWTs are long strings (200+ chars) of base64-like characters
      2. The pattern tries to match, consuming the string greedily
      3. When the match fails at the end, the regex engine backtracks
      4. It tries every possible combination of where the 32+ chars could start/end
      5. This creates exponential time complexity: O(2^n)

      With 50,000 log lines per minute, each taking seconds to process due to
      backtracking, the agent CPU maxes out. The agent can't keep up with log
      ingestion, causing delays in all telemetry.

      Unaffected hosts haven't received the new logging format yet (rolling deploy).
    `,

    codeExamples: [
      {
        lang: 'yaml',
        description: 'Problematic: Backtracking-prone regex',
        code: `log_processing_rules:
  - type: include_at_match
    name: extract_user_context
    # BAD: This pattern causes catastrophic backtracking
    pattern: 'user_id=([a-f0-9-]{36})|session=([A-Za-z0-9+/=]{32,})'`
      },
      {
        lang: 'yaml',
        description: 'Fixed: Bounded, specific regex patterns',
        code: `log_processing_rules:
  - type: include_at_match
    name: extract_user_id
    # GOOD: Specific pattern for user_id only
    pattern: 'user_id[=:]["\\s]*([a-f0-9-]{36})'

  # For session extraction, use a different approach:
  # 1. Don't extract full JWTs (they're too long for labels anyway)
  # 2. Extract just the identifying portion if needed
  - type: include_at_match
    name: extract_session_short
    # Match just the first 32 chars of session for correlation
    pattern: 'session[=:]["\\s]*([A-Za-z0-9+/=]{32})'`
      },
      {
        lang: 'yaml',
        description: 'Better: Use Datadog structured log parsing',
        code: `logs:
  - type: file
    path: /var/log/application/*.log
    service: myapp
    source: nodejs

    # For JSON logs, let Datadog parse automatically
    # No regex needed - it extracts JSON fields natively

    log_processing_rules:
      # Only use regex for simple, bounded patterns
      - type: mask_sequences
        name: mask_api_keys
        # Bounded pattern with negative lookahead
        pattern: '(api_key[=:]\\s*)[A-Za-z0-9]{20,40}(?![A-Za-z0-9])'
        replace_placeholder: '\\1[REDACTED]'`
      },
      {
        lang: 'python',
        description: 'Testing regex patterns for backtracking',
        code: `import re
import time
import signal

class TimeoutError(Exception):
    pass

def timeout_handler(signum, frame):
    raise TimeoutError("Regex timed out!")

def test_regex_safety(pattern: str, test_inputs: list[str], timeout_ms: int = 100):
    """Test a regex pattern against inputs with timeout protection."""
    regex = re.compile(pattern)

    for test_input in test_inputs:
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.setitimer(signal.ITIMER_REAL, timeout_ms / 1000)

        try:
            start = time.time()
            regex.search(test_input)
            elapsed = (time.time() - start) * 1000

            if elapsed > 10:  # More than 10ms is suspicious
                print(f"WARNING: Pattern took {elapsed:.1f}ms on input length {len(test_input)}")
        except TimeoutError:
            print(f"CRITICAL: Pattern timed out on input length {len(test_input)}")
            return False
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)

    return True

# Test with pathological inputs
test_inputs = [
    "normal log line",
    "session=" + "A" * 100,  # Moderate
    "session=" + "A" * 500,  # Long
    '{"session":"' + "eyJ" + "A" * 200 + '"}',  # JWT-like
]

safe = test_regex_safety(r'session=([A-Za-z0-9+/=]{32,})', test_inputs)
print(f"Pattern is {'SAFE' if safe else 'DANGEROUS'}")`
      }
    ],

    prevention: [
      'Test regex patterns with pathological inputs before deploying',
      'Use bounded quantifiers ({32,64} not {32,}) where possible',
      'Prefer Datadog native JSON parsing over regex for structured logs',
      'Set regex timeouts at the agent level if supported',
      'Monitor agent CPU usage with alerts at 50% threshold',
      'Stage log format changes and monitoring config together',
      'Use regex safety testing in CI/CD pipelines'
    ],

    educationalInsights: [
      'Regex backtracking is exponential - small input changes can cause massive slowdowns',
      'Log format changes affect more than just log parsing - monitoring, SIEM, etc.',
      'Greedy quantifiers + long inputs = catastrophic backtracking',
      'The monitoring system itself can be a source of outages',
      'Rolling deploys can mask issues - only some hosts show symptoms initially',
      'Always test regex patterns with adversarial inputs, not just happy paths'
    ]
  }
};
