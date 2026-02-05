import { DetectiveCase } from '../../types';

export const lambdaColdStartCascade: DetectiveCase = {
  id: 'lambda-cold-start-cascade',
  title: 'The Lambda Cold Start Cascade',
  subtitle: 'VPC Lambda functions timing out causing cascading failures across the system',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `
      Your microservices architecture relies heavily on AWS Lambda functions for
      processing. After enabling VPC access for security compliance, intermittent
      timeouts are cascading through the system. Some requests complete in 100ms,
      others timeout after 30 seconds. The pattern seems random and impossible to predict.
    `,
    impact: `
      30% of API requests failing with timeouts. Payment processing delayed, causing
      customer complaints. SLA breaches triggering penalty clauses worth $50K/day.
    `,
    timeline: [
      { time: '2:00 PM', event: 'VPC configuration deployed to Lambda functions', type: 'normal' },
      { time: '2:15 PM', event: 'First timeout errors appear in logs', type: 'warning' },
      { time: '2:30 PM', event: 'Timeout rate reaches 10%', type: 'warning' },
      { time: '3:00 PM', event: 'Cascading failures across downstream services', type: 'critical' },
      { time: '3:30 PM', event: 'Payment processing queue backing up', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Lambda function code executes correctly when it runs',
      'VPC resources (RDS, ElastiCache) are accessible',
      'Warm Lambda invocations complete in 100ms',
      'CloudWatch logs show successful executions'
    ],
    broken: [
      'Random requests timeout after 30 seconds',
      'Cold starts taking 15-25 seconds instead of 1-2 seconds',
      'Downstream services timing out waiting for Lambda responses',
      'Retry storms amplifying the problem'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Lambda Duration Metrics',
      type: 'metrics',
      content: `
## Lambda Invocation Duration (order-processor function)

| Percentile | Pre-VPC | Post-VPC |
|------------|---------|----------|
| p50 | 95ms | 120ms |
| p90 | 150ms | 180ms |
| p99 | 300ms | 28,500ms |
| p99.9 | 450ms | 30,000ms (TIMEOUT) |

**Init Duration Distribution:**
- 0-500ms: 70% of cold starts
- 500ms-5s: 5% of cold starts
- 5s-15s: 10% of cold starts
- 15s-30s: 15% of cold starts (NEW since VPC)
      `,
      hint: 'The p99 latency jumped from 300ms to 28.5 seconds after VPC was enabled'
    },
    {
      id: 2,
      title: 'Lambda VPC Configuration',
      type: 'config',
      content: `
\`\`\`yaml
# serverless.yml
functions:
  orderProcessor:
    handler: src/handlers/order.process
    timeout: 30
    memorySize: 512
    vpc:
      securityGroupIds:
        - sg-0abc123def456
      subnetIds:
        - subnet-private-1a
        - subnet-private-1b
    environment:
      DB_HOST: rds-cluster.internal
      REDIS_HOST: elasticache.internal

# NAT Gateway configuration
# 2 NAT Gateways in 2 AZs
# Each subnet has route to NAT Gateway
\`\`\`
      `,
      hint: 'The Lambda is configured with VPC but only 2 subnets'
    },
    {
      id: 3,
      title: 'ENI Allocation Logs',
      type: 'logs',
      content: `
\`\`\`
# CloudWatch Logs - Lambda Platform
[2024-01-15T15:23:45] START RequestId: abc-123
[2024-01-15T15:23:45] INIT_START Runtime Version: nodejs18.x
[2024-01-15T15:23:46] Preparing ENI for VPC access...
[2024-01-15T15:23:46] Waiting for ENI eni-0xyz789 to become available...
[2024-01-15T15:24:01] ENI eni-0xyz789 attached (waited 15.2s)
[2024-01-15T15:24:02] INIT_REPORT Init Duration: 16234.56 ms

[2024-01-15T15:24:12] START RequestId: def-456
[2024-01-15T15:24:12] INIT_START Runtime Version: nodejs18.x
[2024-01-15T15:24:12] Reusing cached ENI eni-0xyz789
[2024-01-15T15:24:12] INIT_REPORT Init Duration: 234.12 ms

# Note: ENI creation/attachment is the slow path
# ENI reuse (warm start) is fast
\`\`\`
      `,
      hint: 'ENI creation takes 15+ seconds, but reuse is fast'
    },
    {
      id: 4,
      title: 'Concurrency and Scaling Pattern',
      type: 'metrics',
      content: `
## Lambda Concurrent Executions

| Time | Requests/min | Concurrent | Cold Starts | Timeouts |
|------|--------------|------------|-------------|----------|
| 2:00 PM | 100 | 15 | 2 | 0 |
| 2:30 PM | 500 | 80 | 45 | 12 |
| 3:00 PM | 1000 | 150 | 120 | 38 |
| 3:30 PM | 800 | 200 | 180 | 75 |

**Pattern:** Traffic spikes cause many concurrent cold starts.
Each cold start needs an ENI. ENI creation is slow (10-25s).
Downstream services have 5s timeouts -> they give up and retry.
Retries cause more load -> more cold starts -> cascade.
      `,
      hint: 'Traffic spikes cause concurrent cold starts which all need ENIs'
    },
    {
      id: 5,
      title: 'AWS Documentation Excerpt',
      type: 'testimony',
      content: `
> "When you connect a function to a VPC, Lambda creates an elastic network
> interface (ENI) for each combination of security group and subnet in your
> function's VPC configuration. This process can take 10-20 seconds."
>
> "To reduce cold start times for VPC-connected functions:
> - Use Provisioned Concurrency
> - Use VPC endpoints instead of NAT Gateway where possible
> - Ensure sufficient IP addresses in subnets"
>
> "With the 2019 VPC networking improvements, Lambda now uses VPC-to-VPC NAT
> and shared ENIs, reducing cold start times. Ensure your function is using
> the latest runtime version to benefit from these improvements."
>
> -- AWS Lambda Documentation
      `,
      hint: 'AWS provides solutions: Provisioned Concurrency and improved VPC networking'
    },
    {
      id: 6,
      title: 'Subnet IP Address Availability',
      type: 'metrics',
      content: `
\`\`\`
# AWS CLI - Subnet available IPs
$ aws ec2 describe-subnets --subnet-ids subnet-private-1a subnet-private-1b

subnet-private-1a:
  CidrBlock: 10.0.1.0/26 (64 IPs, ~59 usable)
  AvailableIpAddressCount: 3

subnet-private-1b:
  CidrBlock: 10.0.2.0/26 (64 IPs, ~59 usable)
  AvailableIpAddressCount: 7

# Total available: 10 IPs for 200 concurrent Lambda executions!
# Each Lambda execution needs at least 1 IP for ENI
\`\`\`
      `,
      hint: 'Only 10 IPs available for 200 concurrent executions - severe IP exhaustion'
    }
  ],

  solution: {
    diagnosis: 'VPC Lambda cold starts blocked by ENI creation delays and IP address exhaustion in undersized subnets',

    keywords: [
      'lambda', 'vpc', 'cold start', 'eni', 'elastic network interface',
      'provisioned concurrency', 'ip exhaustion', 'subnet', 'cascade',
      'timeout', 'nat gateway', 'cidr'
    ],

    rootCause: `
      When Lambda functions are configured with VPC access, each cold start requires
      an Elastic Network Interface (ENI) to be created and attached. This process
      can take 10-25 seconds, compared to <1 second for non-VPC cold starts.

      The problem was compounded by two factors:

      1. **Small Subnets**: The /26 CIDR blocks only provide ~59 usable IPs each.
         With 200 concurrent executions needed, there weren't enough IPs to create
         ENIs for all the cold starts.

      2. **Traffic Spikes**: When traffic increased, many Lambda instances needed
         to cold start simultaneously. Each needed an ENI, causing:
         - ENI creation delays (15-25 seconds)
         - IP address exhaustion (blocking new ENI creation entirely)
         - 30-second timeouts for requests waiting on cold starts

      3. **Cascade Effect**: Downstream services had 5-second timeouts. When Lambda
         took 25 seconds to cold start, clients would timeout and retry. Retries
         added more load, causing more cold starts, amplifying the problem.
    `,

    codeExamples: [
      {
        lang: 'yaml',
        description: 'Add Provisioned Concurrency to eliminate cold starts',
        code: `# serverless.yml
functions:
  orderProcessor:
    handler: src/handlers/order.process
    timeout: 30
    memorySize: 512
    vpc:
      securityGroupIds:
        - sg-0abc123def456
      subnetIds:
        - subnet-private-1a
        - subnet-private-1b
        - subnet-private-1c  # Add more subnets!
        - subnet-private-1d
    provisionedConcurrency: 50  # Keep 50 instances warm

# Auto-scaling for provisioned concurrency
resources:
  Resources:
    OrderProcessorProvisionedConcurrency:
      Type: AWS::Lambda::Alias
      Properties:
        FunctionName: !Ref OrderProcessorLambdaFunction
        Name: live
        ProvisionedConcurrencyConfig:
          ProvisionedConcurrentExecutions: 50`
      },
      {
        lang: 'typescript',
        description: 'Implement circuit breaker to prevent cascade',
        code: `import CircuitBreaker from 'opossum';

// Wrap Lambda invocation with circuit breaker
const lambdaBreaker = new CircuitBreaker(invokeLambda, {
  timeout: 5000,           // 5 second timeout
  errorThresholdPercentage: 50,
  resetTimeout: 30000,     // Try again after 30s
  volumeThreshold: 10,     // Min requests before tripping
});

lambdaBreaker.on('open', () => {
  console.log('Circuit OPEN - Lambda experiencing issues');
  metrics.increment('circuit.open');
});

lambdaBreaker.on('halfOpen', () => {
  console.log('Circuit HALF-OPEN - Testing Lambda health');
});

lambdaBreaker.fallback(() => {
  // Return cached/default response or queue for later
  return { status: 'queued', message: 'Processing delayed' };
});

async function processOrder(order: Order) {
  return lambdaBreaker.fire(order);
}`
      },
      {
        lang: 'bash',
        description: 'Expand subnet CIDR blocks for more IPs',
        code: `# Current: /26 = 64 IPs per subnet (59 usable)
# Better: /24 = 256 IPs per subnet (251 usable)

# Create larger subnets (plan VPC redesign)
aws ec2 create-subnet \\
  --vpc-id vpc-xxx \\
  --cidr-block 10.0.10.0/24 \\
  --availability-zone us-east-1a \\
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=lambda-private-1a-large}]'

# Add more subnets across AZs
# Lambda will distribute ENIs across all configured subnets

# Monitor IP usage
aws ec2 describe-subnets \\
  --filters "Name=tag:Purpose,Values=lambda" \\
  --query 'Subnets[*].[SubnetId,AvailableIpAddressCount,CidrBlock]'`
      },
      {
        lang: 'typescript',
        description: 'Lambda warmup to prevent cold starts',
        code: `// warmup.ts - Scheduled Lambda to keep functions warm
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({});

const FUNCTIONS_TO_WARM = [
  'order-processor',
  'payment-handler',
  'inventory-checker',
];

const CONCURRENCY_TO_WARM = 20; // Keep 20 instances warm per function

export async function warmupHandler() {
  const warmupPromises = [];

  for (const functionName of FUNCTIONS_TO_WARM) {
    for (let i = 0; i < CONCURRENCY_TO_WARM; i++) {
      warmupPromises.push(
        lambda.send(new InvokeCommand({
          FunctionName: functionName,
          InvocationType: 'Event', // Async
          Payload: JSON.stringify({ warmup: true }),
        }))
      );
    }
  }

  await Promise.all(warmupPromises);
  console.log(\`Warmed \${FUNCTIONS_TO_WARM.length * CONCURRENCY_TO_WARM} instances\`);
}

// In your Lambda function, detect warmup and exit early:
export async function handler(event: any) {
  if (event.warmup) {
    console.log('Warmup invocation');
    return { statusCode: 200, body: 'Warmed' };
  }
  // ... actual logic
}`
      }
    ],

    prevention: [
      'Use Provisioned Concurrency for latency-sensitive VPC Lambdas',
      'Size VPC subnets adequately (/24 or larger for Lambda)',
      'Distribute Lambda across multiple subnets and AZs',
      'Implement circuit breakers on Lambda callers',
      'Set appropriate timeouts with retry budgets',
      'Monitor ENI usage and cold start rates',
      'Use VPC endpoints to reduce NAT Gateway dependency',
      'Consider whether VPC access is truly necessary'
    ],

    educationalInsights: [
      'VPC Lambda cold starts can be 10-100x slower than non-VPC due to ENI creation',
      'IP address exhaustion silently blocks Lambda scaling',
      'Provisioned Concurrency trades cost for latency predictability',
      'Circuit breakers prevent cascade failures from slow dependencies',
      'Retry storms can turn a slow service into a complete outage',
      'AWS improved VPC Lambda networking in 2019, but cold starts still require ENI allocation'
    ]
  }
};
