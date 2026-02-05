import { DetectiveCase } from '../../types';

export const elkStackIndexBloat: DetectiveCase = {
  id: 'elk-stack-index-bloat',
  title: 'The ELK Stack Index Bloat',
  subtitle: 'Elasticsearch cluster full with nowhere to write logs',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your ELK stack is out of disk space. Elasticsearch refuses to accept new documents.
      Logs are being dropped, and you're losing critical audit data. The cluster has been
      running for 2 years and nobody knows what's consuming all the space. Leadership is
      asking why you need more storage when you "only keep 30 days of logs."
    `,
    impact: `
      Log ingestion stopped. Audit compliance at risk (financial services requirement).
      Security team blind to potential incidents. Engineers can't debug production issues.
      Storage costs already 3x budget.
    `,
    timeline: [
      { time: 'Monday', event: 'Disk usage alert: 80% across cluster', type: 'warning' },
      { time: 'Tuesday', event: 'Disk usage at 90%', type: 'warning' },
      { time: 'Wednesday 9AM', event: 'Disk usage at 95%', type: 'critical' },
      { time: 'Wednesday 11AM', event: 'Cluster goes read-only, stops accepting writes', type: 'critical' },
      { time: 'Wednesday 11:05AM', event: 'All log pipelines backing up', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Cluster health is yellow (not red)',
      'Search queries work on existing data',
      'Kibana dashboards load',
      'Network connectivity fine'
    ],
    broken: [
      'Cannot write new documents',
      'Index creation fails',
      'Logstash pipelines backing up',
      'Disk 95%+ on all data nodes'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Elasticsearch Cluster Stats',
      type: 'metrics',
      content: `
\`\`\`bash
$ curl -s localhost:9200/_cluster/stats?human | jq '.indices'
{
  "count": 4247,
  "shards": {
    "total": 25482,
    "primaries": 12741
  },
  "docs": {
    "count": 89234567890,
    "deleted": 234567
  },
  "store": {
    "size": "18.7tb",
    "reserved": "0b"
  },
  "fielddata": {
    "memory_size": "12.4gb"
  }
}

# 4,247 indices using 18.7 TB of storage
\`\`\`
      `,
      hint: '4,247 indices seems like a lot - what are they all?'
    },
    {
      id: 2,
      title: 'Index Listing',
      type: 'logs',
      content: `
\`\`\`bash
$ curl -s localhost:9200/_cat/indices?v&s=index | head -100
health status index                              pri rep docs.count store.size
yellow open   logs-application-2022.01.01          5   1   45234567     12.3gb
yellow open   logs-application-2022.01.02          5   1   43234567     11.9gb
yellow open   logs-application-2022.01.03          5   1   44234567     12.1gb
...
yellow open   logs-application-2024.01.15          5   1   52234567     14.2gb
yellow open   logs-nginx-2022.01.01                5   1   23234567      6.3gb
...
yellow open   metrics-system-2022.01.01            5   1   12234567      3.1gb
...

# Indices go back to January 2022 - over 2 years of data!
# Pattern: logs-{service}-{date} creates ~4 indices per day
# 4 indices × 365 days × 2 years = 2,920 indices (plus metrics, APM, etc.)
\`\`\`
      `,
      hint: 'The indices go back over 2 years - way more than 30 days'
    },
    {
      id: 3,
      title: 'Index Lifecycle Policy',
      type: 'config',
      content: `
\`\`\`bash
$ curl -s localhost:9200/_ilm/policy/logs-policy | jq
{
  "logs-policy": {
    "version": 1,
    "modified_date": "2022-01-15T10:30:00.000Z",
    "policy": {
      "phases": {
        "hot": {
          "min_age": "0ms",
          "actions": {
            "rollover": {
              "max_age": "1d",
              "max_size": "50gb"
            }
          }
        },
        "delete": {
          "min_age": "30d",
          "actions": {
            "delete": {}
          }
        }
      }
    }
  }
}

# Policy looks correct: delete after 30 days
# But wait... let's check if it's actually applied
\`\`\`
      `,
      hint: 'The policy exists, but is it working?'
    },
    {
      id: 4,
      title: 'ILM Status Check',
      type: 'logs',
      content: `
\`\`\`bash
$ curl -s localhost:9200/logs-application-2022.01.01/_ilm/explain | jq
{
  "indices": {
    "logs-application-2022.01.01": {
      "index": "logs-application-2022.01.01",
      "managed": false,
      "index_creation_date_millis": 1641024000000
    }
  }
}

# managed: false - This index is NOT managed by ILM!

$ curl -s localhost:9200/logs-*/_ilm/explain?only_errors=true | jq
{
  "indices": {}
}
# No errors... because the indices aren't managed at all

$ curl -s localhost:9200/_cat/indices?v&h=index,ilm | head -20
index                              ilm
logs-application-2022.01.01        -
logs-application-2022.01.02        -
logs-application-2022.01.03        -
...
# All showing "-" for ILM - none are managed!
\`\`\`
      `,
      hint: 'The ILM policy exists but isn\'t attached to the indices'
    },
    {
      id: 5,
      title: 'Original Setup Documentation',
      type: 'testimony',
      content: `
> "When we set up the ELK stack in 2022, we created the ILM policy for 30-day
> retention. The Logstash config just creates daily indices like logs-app-2022.01.01."
>
> "I don't remember if we linked the policy to an index template. The docs were
> confusing about ILM vs index templates vs data streams. We just got it working
> and moved on."
>
> "Nobody ever complained about old logs being deleted, so we assumed it was working."
>
> — Original DevOps Engineer (now at different company)
      `,
      hint: 'They created the policy but may not have linked it to the indices'
    },
    {
      id: 6,
      title: 'Index Template Investigation',
      type: 'logs',
      content: `
\`\`\`bash
$ curl -s localhost:9200/_index_template/logs-template | jq
{
  "error": {
    "root_cause": [{"type": "resource_not_found_exception"}],
    "type": "resource_not_found_exception",
    "reason": "index template matching [logs-template] not found"
  },
  "status": 404
}

# No index template for logs!

$ curl -s localhost:9200/_template | jq 'keys'
[
  ".monitoring-alerts-7",
  ".monitoring-es",
  "kibana_index_template",
  ".watches"
]

# Only system templates exist - no custom log templates

# For ILM to work, you need:
# 1. ILM policy (exists) ✓
# 2. Index template with policy attached (MISSING!) ✗
# 3. Indices created from template (never happened) ✗

# The policy exists in a vacuum - nothing references it
\`\`\`
      `,
      hint: 'ILM policy exists but there is no index template to apply it'
    }
  ],

  solution: {
    diagnosis: 'ILM policy never attached to index template - indices created unmanaged with no automatic deletion',

    keywords: [
      'ILM', 'index lifecycle management', 'retention', 'index template',
      'elasticsearch', 'disk full', 'delete policy', 'managed', 'unmanaged',
      'bloat', 'storage', 'indices'
    ],

    rootCause: `
      Elasticsearch Index Lifecycle Management (ILM) requires three components to work:

      1. An ILM policy defining the lifecycle phases (hot, warm, cold, delete)
      2. An index template that references the policy
      3. Indices created from that template

      The team created the ILM policy in 2022 with a 30-day delete phase. However,
      they never created an index template that references this policy. Without the
      template, Logstash creates indices with default settings - no ILM attachment.

      For 2+ years, indices were created daily without lifecycle management:
      - ~4 indices per day (different log types)
      - ~1,460 indices per year
      - ~3,000+ indices total
      - Average 5GB per index = 15+ TB accumulated

      The policy sat unused. Nobody noticed because:
      - Old logs were never needed (no one complained about "missing" data)
      - Storage grew slowly (easy to ignore 0.3% daily growth)
      - No monitoring on ILM policy execution

      The cluster finally hit disk limits after 2 years of accumulation.
    `,

    codeExamples: [
      {
        lang: 'bash',
        description: 'Immediate fix: Delete old indices manually',
        code: `# First, enable writes again by freeing space
# Delete indices older than 30 days

# List indices older than 30 days
curl -s localhost:9200/_cat/indices?v | awk '$3 ~ /logs-.*-202[23]/ {print $3}' |
  while read idx; do
    date_part=$(echo $idx | grep -oE '[0-9]{4}\\.[0-9]{2}\\.[0-9]{2}')
    idx_date=$(date -d "$(echo $date_part | tr '.' '-')" +%s 2>/dev/null)
    cutoff=$(date -d "30 days ago" +%s)
    if [ "$idx_date" -lt "$cutoff" ]; then
      echo "Deleting: $idx"
      curl -X DELETE "localhost:9200/$idx"
    fi
  done`
      },
      {
        lang: 'json',
        description: 'Create proper index template with ILM',
        code: `// PUT _index_template/logs-template
{
  "index_patterns": ["logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.lifecycle.name": "logs-policy",
      "index.lifecycle.rollover_alias": "logs"
    },
    "mappings": {
      "properties": {
        "@timestamp": { "type": "date" },
        "message": { "type": "text" },
        "level": { "type": "keyword" },
        "service": { "type": "keyword" }
      }
    }
  },
  "priority": 100,
  "composed_of": [],
  "_meta": {
    "description": "Template for application logs with 30-day retention"
  }
}`
      },
      {
        lang: 'json',
        description: 'Apply ILM to existing unmanaged indices',
        code: `// For each existing index that should be managed:
// PUT logs-application-2024.01.15/_settings
{
  "index.lifecycle.name": "logs-policy"
}

// Bulk apply to all logs-* indices:
// PUT logs-*/_settings
{
  "index.lifecycle.name": "logs-policy"
}

// Verify application:
// GET logs-*/_ilm/explain?filter_path=indices.*.managed`
      },
      {
        lang: 'json',
        description: 'Better: Use Data Streams (ES 7.9+)',
        code: `// Data streams handle rollover and ILM automatically
// Much simpler than index templates

// 1. Create ILM policy
// PUT _ilm/policy/logs-30d-policy
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_primary_shard_size": "50gb",
            "max_age": "1d"
          }
        }
      },
      "delete": {
        "min_age": "30d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}

// 2. Create index template for data stream
// PUT _index_template/logs-ds-template
{
  "index_patterns": ["logs-*"],
  "data_stream": {},
  "template": {
    "settings": {
      "index.lifecycle.name": "logs-30d-policy"
    }
  }
}

// 3. Logstash outputs to data stream automatically
// New indices are managed from creation`
      },
      {
        lang: 'yaml',
        description: 'Add ILM monitoring',
        code: `# Prometheus alerts for ILM health
groups:
  - name: elasticsearch-ilm
    rules:
      - alert: ElasticsearchILMNotManaged
        expr: |
          sum(elasticsearch_indices_ilm_managed{managed="false"}) > 0
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Unmanaged indices detected"

      - alert: ElasticsearchDiskUsageHigh
        expr: |
          elasticsearch_filesystem_data_used_percent > 80
        for: 30m
        labels:
          severity: warning

      - alert: ElasticsearchOldIndices
        expr: |
          sum(elasticsearch_indices_age_days > 30) > 0
        for: 1d
        labels:
          severity: warning
        annotations:
          summary: "Indices older than retention policy exist"`
      }
    ],

    prevention: [
      'Always verify ILM attachment with _ilm/explain after setup',
      'Use data streams instead of index templates for simpler management',
      'Monitor ILM policy execution, not just policy existence',
      'Set up alerts for disk usage trends, not just thresholds',
      'Document ILM setup as runbook with verification steps',
      'Periodic audit of managed vs unmanaged indices'
    ],

    educationalInsights: [
      'ILM policies are useless unless attached to index templates',
      'Index templates only affect NEW indices - existing ones need manual attachment',
      'Data streams (ES 7.9+) combine indices, templates, and ILM into one concept',
      '"No complaints" about deleted data might mean retention isn\'t working at all',
      'Slow growth (0.3%/day) compounds to 3x storage over 2 years',
      'Configuration that "seems to work" should be verified actually works'
    ]
  }
};
