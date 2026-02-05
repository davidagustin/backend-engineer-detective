import { DetectiveCase } from '../../types';

export const ecsTaskPlacement: DetectiveCase = {
  id: 'ecs-task-placement',
  title: 'The ECS Task Placement Failure',
  subtitle: 'Tasks failing to place due to hidden resource constraints',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your ECS service won't scale beyond 10 tasks despite having a desired count
      of 20. Auto-scaling triggers keep firing but tasks stay in PENDING state
      forever. The cluster shows plenty of CPU and memory available, but tasks
      refuse to start. Deployments are stuck and rolling back automatically.
    `,
    impact: `
      Service stuck at 50% capacity during traffic spike. Response times degraded.
      Deployments failing with timeout. Black Friday approaching and scaling doesn't work.
    `,
    timeline: [
      { time: '10:00 AM', event: 'Traffic spike triggers auto-scaling', type: 'normal' },
      { time: '10:02 AM', event: 'Desired count increased to 20 tasks', type: 'normal' },
      { time: '10:05 AM', event: 'New tasks stuck in PENDING state', type: 'warning' },
      { time: '10:15 AM', event: 'Tasks timing out, marked as FAILED', type: 'warning' },
      { time: '10:30 AM', event: 'Service stuck at 10 running tasks', type: 'critical' },
      { time: '11:00 AM', event: 'Deployment rolled back due to health check failures', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Existing 10 tasks running normally',
      'Cluster shows 60% CPU available',
      'Cluster shows 50% memory available',
      'Task definition is valid',
      'Container images pull successfully'
    ],
    broken: [
      'New tasks stuck in PENDING indefinitely',
      'Stopped tasks show reason: "RESOURCE:PORTS"',
      'Can\'t scale past 10 tasks',
      'Service deployment keeps timing out'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'ECS Task Definition',
      type: 'config',
      content: `
\`\`\`json
{
  "family": "api-service",
  "networkMode": "awsvpc",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "api-service:latest",
      "cpu": 512,
      "memory": 1024,
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "hostPort": 3000,
          "protocol": "tcp"
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3
      }
    },
    {
      "name": "datadog-agent",
      "image": "datadog/agent:latest",
      "cpu": 128,
      "memory": 256,
      "essential": false,
      "portMappings": [
        {
          "containerPort": 8125,
          "hostPort": 8125,
          "protocol": "udp"
        },
        {
          "containerPort": 8126,
          "hostPort": 8126,
          "protocol": "tcp"
        }
      ]
    }
  ],
  "requiresCompatibilities": ["EC2"],
  "cpu": "640",
  "memory": "1280"
}
\`\`\`
      `,
      hint: 'Look at the datadog-agent container port mappings - hostPort specified'
    },
    {
      id: 2,
      title: 'ECS Service Events',
      type: 'logs',
      content: `
\`\`\`
service api-service was unable to place a task because no container
instance met all of its requirements. The closest matching container
instance (i-0abc123def) is missing attributes required by your task.
Reason: No Container Instances were found in your cluster.

service api-service was unable to place a task. Reason: No Container
Instances were found in cluster 'production' that match all required
criteria: resource type PORTS, resource value 8125/udp.

service api-service (task task-def:15) registered 1 targets in target
group arn:aws:elasticloadbalancing:...:targetgroup/api/...

(service api-service) failed to launch a task with (error ECS was
unable to assume the role 'arn:aws:iam::...:role/ecsTaskRole' that
was provided for this task... NO WAIT, that's not this error)

Actual error: (service api-service) was unable to place a task because
no container instance met all of its requirements. The closest matching
(i-0def456ghi) has insufficient PORTS.
\`\`\`
      `,
      hint: 'Error says "insufficient PORTS" - the Datadog agent uses host ports'
    },
    {
      id: 3,
      title: 'Cluster Instance Details',
      type: 'metrics',
      content: `
## ECS Cluster: production

| Instance | CPU Avail | Mem Avail | Running Tasks |
|----------|-----------|-----------|---------------|
| i-0abc123 | 2048 | 4096 | 2 (api-service) |
| i-0def456 | 2048 | 4096 | 2 (api-service) |
| i-0ghi789 | 2048 | 4096 | 2 (api-service) |
| i-0jkl012 | 2048 | 4096 | 2 (api-service) |
| i-0mno345 | 2048 | 4096 | 2 (api-service) |

**Totals:**
- 5 instances
- 10 tasks running (2 per instance)
- 10,240 CPU units available
- 20,480 MB memory available
- Task requires: 640 CPU, 1280 MB

**Question:** With 10K CPU and 20GB RAM available, why can't we run 10 more tasks?
      `,
      hint: 'Each instance runs exactly 2 tasks, no more'
    },
    {
      id: 4,
      title: 'ECS Port Usage Analysis',
      type: 'code',
      content: `
\`\`\`bash
# Check what ports are in use on each instance

# Instance i-0abc123 (running 2 api-service tasks)
$ docker ps --format "table {{.Ports}}"
PORTS
0.0.0.0:3000->3000/tcp    # Task 1 - API
0.0.0.0:8125->8125/udp    # Task 1 - Datadog StatsD
0.0.0.0:8126->8126/tcp    # Task 1 - Datadog APM
0.0.0.0:3001->3000/tcp    # Task 2 - API (different host port because awsvpc)
0.0.0.0:8125->8125/udp    # ERROR! Can't bind - port already in use!
0.0.0.0:8126->8126/tcp    # ERROR! Can't bind - port already in use!

# Wait, awsvpc mode... let me check again
# In awsvpc mode, each task gets its own ENI with its own IP
# BUT hostPort binding still applies!

# The Datadog sidecar specifies hostPort: 8125 and hostPort: 8126
# These are HOST ports, not container ports
# Only ONE task per host can use port 8125!
\`\`\`
      `,
      hint: 'hostPort binding limits to one container per host per port'
    },
    {
      id: 5,
      title: 'AWS Documentation on Port Mappings',
      type: 'testimony',
      content: `
> "If you are using containers in a task with the awsvpc network mode,
> the hostPort can either be left blank or set to the same value as
> the containerPort."
>
> "If you are using containers in a task with the host network mode,
> the hostPort must either be left blank or be the same value as the
> containerPort."
>
> "For task definitions that use the awsvpc network mode, you should
> only specify the containerPort. The hostPort can be left blank or it
> must be the same value as the containerPort."
>
> "When hostPort is specified, only ONE container on EACH HOST can use
> that port. This effectively limits task density."
>
> -- AWS ECS Developer Guide
      `,
      hint: 'Setting hostPort limits you to one task per host using that port'
    },
    {
      id: 6,
      title: 'Datadog Agent Deployment Options',
      type: 'config',
      content: `
\`\`\`markdown
# Datadog Agent on ECS - Deployment Options

## Option 1: Sidecar (Current - Problematic)
- Agent runs in same task as app
- Uses hostPort for DogStatsD (8125) and APM (8126)
- PROBLEM: Only one task per host can use those ports!
- Severely limits task density

## Option 2: Daemon Service (Recommended)
- Run Datadog agent as ECS daemon service
- ONE agent per host, shared by all tasks
- No port conflicts
- More efficient resource usage

## Option 3: Sidecar without hostPort
- Remove hostPort from sidecar definition
- Use localhost (127.0.0.1) for communication
- Each task has its own Datadog agent
- Less efficient but no port conflicts

## Option 4: Unix Domain Socket (Best for APM)
- Use UDS instead of TCP for APM
- No port conflicts
- Better performance
\`\`\`
      `,
      hint: 'Daemon service pattern avoids port conflicts while providing monitoring'
    }
  ],

  solution: {
    diagnosis: 'Datadog sidecar container with hostPort binding limited task placement to one task per port per host',

    keywords: [
      'ecs', 'task placement', 'port conflict', 'hostport', 'containerport',
      'awsvpc', 'daemon service', 'sidecar', 'resource constraint',
      'port binding', 'task density'
    ],

    rootCause: `
      The task definition included a Datadog agent sidecar with explicit hostPort
      mappings for ports 8125 (StatsD) and 8126 (APM trace collector).

      In ECS, when you specify a hostPort, only ONE container on that host can
      bind to that port. Even with awsvpc network mode (where each task gets its
      own ENI and IP address), the hostPort is still bound on the HOST, not
      the task's network namespace.

      With 5 EC2 instances and ports 8125/8126 claimed by one task each:
      - Maximum tasks per host = 1 (limited by port 8125)
      - Maximum cluster capacity = 5 tasks

      But they had 2 tasks per host because... wait, that's strange. Looking
      closer: The first task on each host successfully bound 8125/8126. The
      second task's Datadog container failed to start, but since it was marked
      as "essential: false", ECS considered the task healthy and ran it without
      Datadog. When trying to start a third task, it failed immediately because
      the essential API container also couldn't be placed (ECS checks all port
      requirements before placement).

      Net result: 2 tasks per host (one with Datadog, one without), and no
      ability to scale further because ECS saw insufficient ports.
    `,

    codeExamples: [
      {
        lang: 'json',
        description: 'Fix 1: Remove hostPort from sidecar (use container networking)',
        code: `{
  "name": "datadog-agent",
  "image": "datadog/agent:latest",
  "cpu": 128,
  "memory": 256,
  "essential": false,
  "portMappings": [
    {
      "containerPort": 8125,
      "protocol": "udp"
      // NO hostPort - use container's IP via awsvpc
    },
    {
      "containerPort": 8126,
      "protocol": "tcp"
      // NO hostPort
    }
  ],
  "environment": [
    {
      "name": "DD_APM_NON_LOCAL_TRAFFIC",
      "value": "true"
    }
  ]
}

// In your app container, use localhost to reach Datadog:
// DD_AGENT_HOST=127.0.0.1 (sidecars share network namespace)
// This works because in awsvpc mode, all containers in a task
// share the same network interface`
      },
      {
        lang: 'yaml',
        description: 'Fix 2: Use Datadog as a daemon service (recommended)',
        code: `# datadog-daemon.yaml - CloudFormation

DatadogDaemonService:
  Type: AWS::ECS::Service
  Properties:
    ServiceName: datadog-agent
    Cluster: !Ref ECSCluster
    TaskDefinition: !Ref DatadogTaskDefinition
    SchedulingStrategy: DAEMON  # One per host!
    # No desired count - daemon runs on all instances

DatadogTaskDefinition:
  Type: AWS::ECS::TaskDefinition
  Properties:
    Family: datadog-agent
    NetworkMode: host  # Use host networking for daemon
    ContainerDefinitions:
      - Name: datadog-agent
        Image: datadog/agent:latest
        Cpu: 128
        Memory: 256
        Essential: true
        PortMappings:
          - ContainerPort: 8125
            HostPort: 8125  # OK for daemon - one per host
            Protocol: udp
          - ContainerPort: 8126
            HostPort: 8126
            Protocol: tcp
        Environment:
          - Name: DD_API_KEY
            Value: !Ref DatadogApiKey
          - Name: DD_APM_ENABLED
            Value: "true"
          - Name: DD_DOGSTATSD_NON_LOCAL_TRAFFIC
            Value: "true"

# App task definition - NO Datadog sidecar
ApiTaskDefinition:
  Type: AWS::ECS::TaskDefinition
  Properties:
    Family: api-service
    NetworkMode: awsvpc
    ContainerDefinitions:
      - Name: api
        Image: api-service:latest
        Cpu: 512
        Memory: 1024
        Essential: true
        PortMappings:
          - ContainerPort: 3000  # No hostPort needed
        Environment:
          - Name: DD_AGENT_HOST
            Value: "169.254.169.254"  # Host IP via link-local
          # OR use the instance's private IP`
      },
      {
        lang: 'typescript',
        description: 'App configuration to find Datadog daemon',
        code: `// In your app, find the Datadog agent on the EC2 host

import { getInstanceMetadata } from './aws-utils';

async function getDatadogHost(): Promise<string> {
  // Option 1: Use ECS container metadata
  const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (metadataUri) {
    const taskMetadata = await fetch(\`\${metadataUri}/task\`).then(r => r.json());
    // For awsvpc, get the host's IP from task metadata
    // This is complex - better to use Option 2
  }

  // Option 2: Use instance metadata service
  // Works if Datadog daemon uses host networking
  const hostIp = await getInstanceMetadata('local-ipv4');
  return hostIp;

  // Option 3: Use environment variable set by ECS
  return process.env.DD_AGENT_HOST || 'localhost';
}

// Initialize Datadog client
import { StatsD } from 'hot-shots';

const datadogHost = await getDatadogHost();
const dogstatsd = new StatsD({
  host: datadogHost,
  port: 8125,
});

// For APM tracing
import tracer from 'dd-trace';
tracer.init({
  hostname: datadogHost,
  port: 8126,
});`
      },
      {
        lang: 'bash',
        description: 'Diagnose ECS placement issues',
        code: `#!/bin/bash
# diagnose-ecs-placement.sh

CLUSTER="production"
SERVICE="api-service"

echo "=== Cluster Capacity ==="
aws ecs describe-container-instances \\
  --cluster $CLUSTER \\
  --container-instances $(aws ecs list-container-instances --cluster $CLUSTER --query 'containerInstanceArns[]' --output text) \\
  --query 'containerInstances[].{id:ec2InstanceId,cpu:remainingResources[?name==\`CPU\`].integerValue|[0],mem:remainingResources[?name==\`MEMORY\`].integerValue|[0],ports:remainingResources[?name==\`PORTS\`].stringSetValue|[0]}' \\
  --output table

echo ""
echo "=== Service Events (Last 10) ==="
aws ecs describe-services \\
  --cluster $CLUSTER \\
  --services $SERVICE \\
  --query 'services[0].events[:10].[createdAt,message]' \\
  --output table

echo ""
echo "=== Stopped Tasks Reasons ==="
aws ecs describe-tasks \\
  --cluster $CLUSTER \\
  --tasks $(aws ecs list-tasks --cluster $CLUSTER --service-name $SERVICE --desired-status STOPPED --query 'taskArns[:5]' --output text) \\
  --query 'tasks[].[taskArn,stoppedReason]' \\
  --output table 2>/dev/null || echo "No stopped tasks found"

echo ""
echo "=== Task Definition Port Mappings ==="
TASK_DEF=$(aws ecs describe-services --cluster $CLUSTER --services $SERVICE --query 'services[0].taskDefinition' --output text)
aws ecs describe-task-definition \\
  --task-definition $TASK_DEF \\
  --query 'taskDefinition.containerDefinitions[].{name:name,ports:portMappings[].{container:containerPort,host:hostPort}}' \\
  --output yaml`
      }
    ],

    prevention: [
      'Avoid hostPort unless absolutely necessary (limits to 1 task per port per host)',
      'Use awsvpc network mode and containerPort only for task flexibility',
      'Deploy shared agents as daemon services, not sidecars',
      'Monitor ECS service events for placement failures',
      'Set up alerts for tasks stuck in PENDING state',
      'Document port usage across all task definitions',
      'Test scaling to max capacity in staging before production',
      'Consider Fargate for simpler resource management'
    ],

    educationalInsights: [
      'hostPort creates a 1:1 mapping between task and port per host',
      'awsvpc gives each task its own ENI but hostPort still binds to host',
      'Daemon services are perfect for per-host agents like Datadog, Fluentd',
      'ECS placement constraints include CPU, memory, ports, and custom attributes',
      'essential: false sidecars can mask placement problems by failing silently',
      '"Insufficient PORTS" errors indicate hostPort conflicts, not network capacity'
    ]
  }
};
