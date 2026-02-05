/**
 * Case Registry - exports all detective cases and provides lookup utilities.
 */

import type { DetectiveCase, CaseSummary, CaseView } from "../types";

// Import all cases
import { databaseDisappearingAct } from "./data/01-database-disappearing-act";
import { blackFridayDisaster } from "./data/02-black-friday-disaster";
import { memoryExplosionMystery } from "./data/03-memory-explosion-mystery";
import { ghostUsersProblem } from "./data/04-ghost-users-problem";
import { infiniteLoopIncident } from "./data/05-infinite-loop-incident";
import { mysteriousMemoryLeak } from "./data/06-mysterious-memory-leak";
import { silentAuthCrisis } from "./data/07-silent-auth-crisis";
import { vanishingAchievements } from "./data/08-vanishing-achievements";
import { weekendWarriorsCrisis } from "./data/09-weekend-warriors-crisis";
import { mysteriousSlowLogins } from "./data/10-mysterious-slow-logins";
import { phantomFriendRequests } from "./data/11-phantom-friend-requests";
import { midnightDataSwap } from "./data/12-midnight-data-swap";
import { databaseInconsistency } from "./data/13-database-inconsistency";
import { invisibleApi } from "./data/14-invisible-api";
import { vanishingMultiplayerMatches } from "./data/15-vanishing-multiplayer-matches";
import { invisibleTrafficSpike } from "./data/16-invisible-traffic-spike";
import { kubernetesPodMystery } from "./data/17-kubernetes-pod-mystery";
import { kafkaConsumerLag } from "./data/18-kafka-consumer-lag";
import { graphqlNPlusOne } from "./data/19-graphql-n-plus-one";
import { websocketMemoryLeak } from "./data/20-websocket-memory-leak";
import { featureFlagFiasco } from "./data/21-feature-flag-fiasco";
import { elasticsearchIndexingStorm } from "./data/22-elasticsearch-indexing-storm";

// Cases 23-32: AWS infrastructure and services
import { lambdaColdStartCascade } from "./data/23-lambda-cold-start-cascade";
import { s3EventualConsistency } from "./data/24-s3-eventual-consistency";
import { dynamodbHotPartition } from "./data/25-dynamodb-hot-partition";
import { rdsConnectionStorm } from "./data/26-rds-connection-storm";
import { sqsMessageDuplication } from "./data/27-sqs-message-duplication";
import { cloudfrontCachePoisoning } from "./data/28-cloudfront-cache-poisoning";
import { ecsTaskPlacement } from "./data/29-ecs-task-placement";
import { secretsManagerRateLimit } from "./data/30-secrets-manager-rate-limit";
import { albTargetDeregistration } from "./data/31-alb-target-deregistration";
import { snsFanoutBottleneck } from "./data/32-sns-fanout-bottleneck";

import { kubernetesHpaThrashing } from "./data/53-kubernetes-hpa-thrashing";
import { istioSidecarInjectionFailure } from "./data/54-istio-sidecar-injection-failure";
import { helmChartVersionDrift } from "./data/55-helm-chart-version-drift";
import { kubernetesCrashLoopBackOff } from "./data/56-kubernetes-crashloopbackoff";
import { serviceMeshMtlsExpiry } from "./data/57-service-mesh-mtls-expiry";
import { kubernetesPvcStuckTerminating } from "./data/58-kubernetes-pvc-stuck-terminating";
import { dockerLayerCacheInvalidation } from "./data/59-docker-layer-cache-invalidation";
import { kubernetesNodeNotReady } from "./data/60-kubernetes-node-not-ready";
import { envoyProxyCircuitBreak } from "./data/61-envoy-proxy-circuit-break";
import { argocdSyncLoop } from "./data/62-argocd-sync-loop";

// Cases 33-42: Database and distributed systems deep dives
import { postgresqlVacuumFreeze } from "./data/33-postgresql-vacuum-freeze";
import { mongodbWriteConcern } from "./data/34-mongodb-write-concern";
import { cassandraTombstoneAvalanche } from "./data/35-cassandra-tombstone-avalanche";
import { mysqlReplicationLag } from "./data/36-mysql-replication-lag";
import { redisClusterSlotMigration } from "./data/37-redis-cluster-slot-migration";
import { cockroachdbClockSkew } from "./data/38-cockroachdb-clock-skew";
import { postgresqlLockContention } from "./data/39-postgresql-lock-contention";
import { mongodbShardingJumboChunks } from "./data/40-mongodb-sharding-jumbo-chunks";
import { mysqlIndexCardinality } from "./data/41-mysql-index-cardinality";
import { timescaledbChunkCompression } from "./data/42-timescaledb-chunk-compression";

// Cases 43-52: Message queues and streaming platforms
import { rabbitmqMemoryAlarm } from "./data/43-rabbitmq-memory-alarm";
import { kafkaRebalanceStorm } from "./data/44-kafka-rebalance-storm";
import { natsJetstreamReplay } from "./data/45-nats-jetstream-replay";
import { redisPubsubBackpressure } from "./data/46-redis-pubsub-backpressure";
import { pulsarBacklog } from "./data/47-pulsar-backlog";
import { celeryVisibilityTimeout } from "./data/48-celery-visibility-timeout";
import { kinesisShardIteratorExpiry } from "./data/49-kinesis-shard-iterator-expiry";
import { bullQueueStalledJobs } from "./data/50-bull-queue-stalled-jobs";
import { mqttQosMismatch } from "./data/51-mqtt-qos-mismatch";
import { pubsubAckDeadline } from "./data/52-pubsub-ack-deadline";

// Cases 63-72: Authentication, API design, and networking
import { jwtTokenSizeExplosion } from "./data/63-jwt-token-size-explosion";
import { oauth2RefreshTokenRace } from "./data/64-oauth2-refresh-token-race";
import { corsPreflightCacheMiss } from "./data/65-cors-preflight-cache-miss";
import { apiRateLimitLeak } from "./data/66-api-rate-limit-leak";
import { grpcDeadlinePropagation } from "./data/67-grpc-deadline-propagation";
import { restApiPaginationDrift } from "./data/68-rest-api-pagination-drift";
import { graphqlQueryComplexityAttack } from "./data/69-graphql-query-complexity-attack";
import { openapiSchemaDrift } from "./data/70-openapi-schema-drift";
import { mtlsClientCertificateRotation } from "./data/71-mtls-client-certificate-rotation";
import { apiGatewayTimeoutMismatch } from "./data/72-api-gateway-timeout-mismatch";

// Cases 73-82: Monitoring and observability
import { prometheusCardinalityExplosion } from "./data/73-prometheus-cardinality-explosion";
import { datadogAgentCpuSpike } from "./data/74-datadog-agent-cpu-spike";
import { elkStackIndexBloat } from "./data/75-elk-stack-index-bloat";
import { jaegerTraceSamplingBias } from "./data/76-jaeger-trace-sampling-bias";
import { pagerdutyAlertFatigue } from "./data/77-pagerduty-alert-fatigue";
import { grafanaDashboardTimeout } from "./data/78-grafana-dashboard-timeout";
import { newRelicApmOverhead } from "./data/79-new-relic-apm-overhead";
import { opentelemetryContextLoss } from "./data/80-opentelemetry-context-loss";
import { cloudwatchLogInsightsCost } from "./data/81-cloudwatch-log-insights-cost";
import { sentryEventFlood } from "./data/82-sentry-event-flood";

// Cases 83-92: Language runtime issues
import { nodejsEventLoopStarvation } from "./data/83-nodejs-event-loop-starvation";
import { javaGcStopTheWorld } from "./data/84-java-gc-stop-the-world";
import { goGoroutineLeak } from "./data/85-go-goroutine-leak";
import { pythonGilContention } from "./data/86-python-gil-contention";
import { rustAsyncRuntimeStarvation } from "./data/87-rust-async-runtime-starvation";
import { phpFpmProcessExhaustion } from "./data/88-php-fpm-process-exhaustion";
import { rubyThreadPoolDeadlock } from "./data/89-ruby-thread-pool-deadlock";
import { dotnetLohFragmentation } from "./data/90-dotnet-loh-fragmentation";
import { jvmMetaspaceLeak } from "./data/91-jvm-metaspace-leak";
import { nodejsBufferPoolExhaustion } from "./data/92-nodejs-buffer-pool-exhaustion";

// Cases 93-102: Load balancing and proxies
import { nginxUpstreamTimeout } from "./data/93-nginx-upstream-timeout";
import { haproxyHealthCheckFlap } from "./data/94-haproxy-health-check-flap";
import { tcpConnectionResetStorm } from "./data/95-tcp-connection-reset-storm";
import { dnsTtlCachePoisoning } from "./data/96-dns-ttl-cache-poisoning";
import { tlsHandshakeTimeout } from "./data/97-tls-handshake-timeout";
import { http2StreamMultiplexing } from "./data/98-http2-stream-multiplexing";
import { bgpRouteLeak } from "./data/99-bgp-route-leak";
import { mtuPathDiscoveryFailure } from "./data/100-mtu-path-discovery-failure";
import { loadBalancerStickySession } from "./data/101-load-balancer-sticky-session";
import { websocketProxyBuffering } from "./data/102-websocket-proxy-buffering";

// Cases 103-111: Resilience patterns and distributed systems
import { circuitBreakerHalfOpen } from "./data/103-circuit-breaker-half-open";
import { retryStormAmplification } from "./data/104-retry-storm-amplification";
import { bulkheadIsolationBreach } from "./data/105-bulkhead-isolation-breach";
import { sagaCompensationFailure } from "./data/106-saga-compensation-failure";
import { eventSourcingProjectionLag } from "./data/107-event-sourcing-projection-lag";
import { cqrsCommandValidation } from "./data/108-cqrs-command-validation";
import { idempotencyKeyCollision } from "./data/109-idempotency-key-collision";
import { twoPhaseCommitTimeout } from "./data/110-two-phase-commit-timeout";
import { optimisticLockingConflict } from "./data/111-optimistic-locking-conflict";

// Cases 113-122: DevOps and deployment
import { ciPipelineCacheCorruption } from "./data/113-ci-pipeline-cache-corruption";
import { blueGreenDeploymentDns } from "./data/114-blue-green-deployment-dns";
import { canaryReleaseMetricSkew } from "./data/115-canary-release-metric-skew";
import { databaseMigrationLock } from "./data/116-database-migration-lock";
import { featureToggleMemoryLeak } from "./data/117-feature-toggle-memory-leak";
import { configHotReloadRace } from "./data/118-config-hot-reload-race";
import { zeroDowntimeDeployFailure } from "./data/119-zero-downtime-deploy-failure";
import { terraformStateCorruption } from "./data/120-terraform-state-corruption";
import { gitopsSyncConflict } from "./data/121-gitops-sync-conflict";
import { secretRotationFailure } from "./data/122-secret-rotation-failure";

/**
 * All detective cases indexed by ID.
 */
export const cases: Record<string, DetectiveCase> = {
	"database-disappearing-act": databaseDisappearingAct,
	"black-friday-disaster": blackFridayDisaster,
	"memory-explosion-mystery": memoryExplosionMystery,
	"ghost-users-problem": ghostUsersProblem,
	"infinite-loop-incident": infiniteLoopIncident,
	"mysterious-memory-leak": mysteriousMemoryLeak,
	"silent-auth-crisis": silentAuthCrisis,
	"vanishing-achievements": vanishingAchievements,
	"weekend-warriors-crisis": weekendWarriorsCrisis,
	"mysterious-slow-logins": mysteriousSlowLogins,
	"phantom-friend-requests": phantomFriendRequests,
	"midnight-data-swap": midnightDataSwap,
	"database-inconsistency": databaseInconsistency,
	"invisible-api": invisibleApi,
	"vanishing-multiplayer-matches": vanishingMultiplayerMatches,
	"invisible-traffic-spike": invisibleTrafficSpike,
	"kubernetes-pod-mystery": kubernetesPodMystery,
	"kafka-consumer-lag": kafkaConsumerLag,
	"graphql-n-plus-one": graphqlNPlusOne,
	"websocket-memory-leak": websocketMemoryLeak,
	"feature-flag-fiasco": featureFlagFiasco,
	"elasticsearch-indexing-storm": elasticsearchIndexingStorm,
	// Cases 23-32: AWS infrastructure and services
	"lambda-cold-start-cascade": lambdaColdStartCascade,
	"s3-eventual-consistency": s3EventualConsistency,
	"dynamodb-hot-partition": dynamodbHotPartition,
	"rds-connection-storm": rdsConnectionStorm,
	"sqs-message-duplication": sqsMessageDuplication,
	"cloudfront-cache-poisoning": cloudfrontCachePoisoning,
	"ecs-task-placement": ecsTaskPlacement,
	"secrets-manager-rate-limit": secretsManagerRateLimit,
	"alb-target-deregistration": albTargetDeregistration,
	"sns-fanout-bottleneck": snsFanoutBottleneck,
	// Cases 53-62: Kubernetes and DevOps
	"kubernetes-hpa-thrashing": kubernetesHpaThrashing,
	"istio-sidecar-injection-failure": istioSidecarInjectionFailure,
	"helm-chart-version-drift": helmChartVersionDrift,
	"kubernetes-crashloopbackoff": kubernetesCrashLoopBackOff,
	"service-mesh-mtls-expiry": serviceMeshMtlsExpiry,
	"kubernetes-pvc-stuck-terminating": kubernetesPvcStuckTerminating,
	"docker-layer-cache-invalidation": dockerLayerCacheInvalidation,
	"kubernetes-node-not-ready": kubernetesNodeNotReady,
	"envoy-proxy-circuit-break": envoyProxyCircuitBreak,
	"argocd-sync-loop": argocdSyncLoop,
	// Cases 33-42
	"postgresql-vacuum-freeze": postgresqlVacuumFreeze,
	"mongodb-write-concern": mongodbWriteConcern,
	"cassandra-tombstone-avalanche": cassandraTombstoneAvalanche,
	"mysql-replication-lag": mysqlReplicationLag,
	"redis-cluster-slot-migration": redisClusterSlotMigration,
	"cockroachdb-clock-skew": cockroachdbClockSkew,
	"postgresql-lock-contention": postgresqlLockContention,
	"mongodb-sharding-jumbo-chunks": mongodbShardingJumboChunks,
	"mysql-index-cardinality": mysqlIndexCardinality,
	"timescaledb-chunk-compression": timescaledbChunkCompression,
	// Cases 43-52: Message queues and streaming
	"rabbitmq-memory-alarm": rabbitmqMemoryAlarm,
	"kafka-rebalance-storm": kafkaRebalanceStorm,
	"nats-jetstream-replay": natsJetstreamReplay,
	"redis-pubsub-backpressure": redisPubsubBackpressure,
	"pulsar-backlog": pulsarBacklog,
	"celery-visibility-timeout": celeryVisibilityTimeout,
	"kinesis-shard-iterator-expiry": kinesisShardIteratorExpiry,
	"bull-queue-stalled-jobs": bullQueueStalledJobs,
	"mqtt-qos-mismatch": mqttQosMismatch,
	"pubsub-ack-deadline": pubsubAckDeadline,
	// Cases 63-72: Authentication and API design
	"jwt-token-size-explosion": jwtTokenSizeExplosion,
	"oauth2-refresh-token-race": oauth2RefreshTokenRace,
	"cors-preflight-cache-miss": corsPreflightCacheMiss,
	"api-rate-limit-leak": apiRateLimitLeak,
	"grpc-deadline-propagation": grpcDeadlinePropagation,
	"rest-api-pagination-drift": restApiPaginationDrift,
	"graphql-query-complexity-attack": graphqlQueryComplexityAttack,
	"openapi-schema-drift": openapiSchemaDrift,
	"mtls-client-certificate-rotation": mtlsClientCertificateRotation,
	"api-gateway-timeout-mismatch": apiGatewayTimeoutMismatch,
	// Cases 73-82: Monitoring and observability
	"prometheus-cardinality-explosion": prometheusCardinalityExplosion,
	"datadog-agent-cpu-spike": datadogAgentCpuSpike,
	"elk-stack-index-bloat": elkStackIndexBloat,
	"jaeger-trace-sampling-bias": jaegerTraceSamplingBias,
	"pagerduty-alert-fatigue": pagerdutyAlertFatigue,
	"grafana-dashboard-timeout": grafanaDashboardTimeout,
	"new-relic-apm-overhead": newRelicApmOverhead,
	"opentelemetry-context-loss": opentelemetryContextLoss,
	"cloudwatch-log-insights-cost": cloudwatchLogInsightsCost,
	"sentry-event-flood": sentryEventFlood,
	// Cases 83-92: Language runtime issues
	"nodejs-event-loop-starvation": nodejsEventLoopStarvation,
	"java-gc-stop-the-world": javaGcStopTheWorld,
	"go-goroutine-leak": goGoroutineLeak,
	"python-gil-contention": pythonGilContention,
	"rust-async-runtime-starvation": rustAsyncRuntimeStarvation,
	"php-fpm-process-exhaustion": phpFpmProcessExhaustion,
	"ruby-thread-pool-deadlock": rubyThreadPoolDeadlock,
	"dotnet-loh-fragmentation": dotnetLohFragmentation,
	"jvm-metaspace-leak": jvmMetaspaceLeak,
	"nodejs-buffer-pool-exhaustion": nodejsBufferPoolExhaustion,
	// Cases 93-102: Load balancing and proxies
	"nginx-upstream-timeout": nginxUpstreamTimeout,
	"haproxy-health-check-flap": haproxyHealthCheckFlap,
	"tcp-connection-reset-storm": tcpConnectionResetStorm,
	"dns-ttl-cache-poisoning": dnsTtlCachePoisoning,
	"tls-handshake-timeout": tlsHandshakeTimeout,
	"http2-stream-multiplexing": http2StreamMultiplexing,
	"bgp-route-leak": bgpRouteLeak,
	"mtu-path-discovery-failure": mtuPathDiscoveryFailure,
	"load-balancer-sticky-session": loadBalancerStickySession,
	"websocket-proxy-buffering": websocketProxyBuffering,
	// Cases 103-111: Resilience patterns
	"circuit-breaker-half-open": circuitBreakerHalfOpen,
	"retry-storm-amplification": retryStormAmplification,
	"bulkhead-isolation-breach": bulkheadIsolationBreach,
	"saga-compensation-failure": sagaCompensationFailure,
	"event-sourcing-projection-lag": eventSourcingProjectionLag,
	"cqrs-command-validation": cqrsCommandValidation,
	"idempotency-key-collision": idempotencyKeyCollision,
	"two-phase-commit-timeout": twoPhaseCommitTimeout,
	"optimistic-locking-conflict": optimisticLockingConflict,
	// Cases 113-122: DevOps and deployment
	"ci-pipeline-cache-corruption": ciPipelineCacheCorruption,
	"blue-green-deployment-dns": blueGreenDeploymentDns,
	"canary-release-metric-skew": canaryReleaseMetricSkew,
	"database-migration-lock": databaseMigrationLock,
	"feature-toggle-memory-leak": featureToggleMemoryLeak,
	"config-hot-reload-race": configHotReloadRace,
	"zero-downtime-deploy-failure": zeroDowntimeDeployFailure,
	"terraform-state-corruption": terraformStateCorruption,
	"gitops-sync-conflict": gitopsSyncConflict,
	"secret-rotation-failure": secretRotationFailure,
};

/**
 * Ordered list of case IDs for consistent display.
 */
export const caseOrder: string[] = [
	"database-disappearing-act",
	"black-friday-disaster",
	"memory-explosion-mystery",
	"ghost-users-problem",
	"infinite-loop-incident",
	"mysterious-memory-leak",
	"silent-auth-crisis",
	"vanishing-achievements",
	"weekend-warriors-crisis",
	"mysterious-slow-logins",
	"phantom-friend-requests",
	"midnight-data-swap",
	"database-inconsistency",
	"invisible-api",
	"vanishing-multiplayer-matches",
	"invisible-traffic-spike",
	"kubernetes-pod-mystery",
	"kafka-consumer-lag",
	"graphql-n-plus-one",
	"websocket-memory-leak",
	"feature-flag-fiasco",
	"elasticsearch-indexing-storm",
	// Cases 23-32: AWS infrastructure and services
	"lambda-cold-start-cascade",
	"s3-eventual-consistency",
	"dynamodb-hot-partition",
	"rds-connection-storm",
	"sqs-message-duplication",
	"cloudfront-cache-poisoning",
	"ecs-task-placement",
	"secrets-manager-rate-limit",
	"alb-target-deregistration",
	"sns-fanout-bottleneck",
	// Cases 53-62: Kubernetes and DevOps
	"kubernetes-hpa-thrashing",
	"istio-sidecar-injection-failure",
	"helm-chart-version-drift",
	"kubernetes-crashloopbackoff",
	"service-mesh-mtls-expiry",
	"kubernetes-pvc-stuck-terminating",
	"docker-layer-cache-invalidation",
	"kubernetes-node-not-ready",
	"envoy-proxy-circuit-break",
	"argocd-sync-loop",
	// Cases 33-42
	"postgresql-vacuum-freeze",
	"mongodb-write-concern",
	"cassandra-tombstone-avalanche",
	"mysql-replication-lag",
	"redis-cluster-slot-migration",
	"cockroachdb-clock-skew",
	"postgresql-lock-contention",
	"mongodb-sharding-jumbo-chunks",
	"mysql-index-cardinality",
	"timescaledb-chunk-compression",
	// Cases 43-52: Message queues and streaming
	"rabbitmq-memory-alarm",
	"kafka-rebalance-storm",
	"nats-jetstream-replay",
	"redis-pubsub-backpressure",
	"pulsar-backlog",
	"celery-visibility-timeout",
	"kinesis-shard-iterator-expiry",
	"bull-queue-stalled-jobs",
	"mqtt-qos-mismatch",
	"pubsub-ack-deadline",
	// Cases 63-72: Authentication and API design
	"jwt-token-size-explosion",
	"oauth2-refresh-token-race",
	"cors-preflight-cache-miss",
	"api-rate-limit-leak",
	"grpc-deadline-propagation",
	"rest-api-pagination-drift",
	"graphql-query-complexity-attack",
	"openapi-schema-drift",
	"mtls-client-certificate-rotation",
	"api-gateway-timeout-mismatch",
	// Cases 73-82: Monitoring and observability
	"prometheus-cardinality-explosion",
	"datadog-agent-cpu-spike",
	"elk-stack-index-bloat",
	"jaeger-trace-sampling-bias",
	"pagerduty-alert-fatigue",
	"grafana-dashboard-timeout",
	"new-relic-apm-overhead",
	"opentelemetry-context-loss",
	"cloudwatch-log-insights-cost",
	"sentry-event-flood",
	// Cases 83-92: Language runtime issues
	"nodejs-event-loop-starvation",
	"java-gc-stop-the-world",
	"go-goroutine-leak",
	"python-gil-contention",
	"rust-async-runtime-starvation",
	"php-fpm-process-exhaustion",
	"ruby-thread-pool-deadlock",
	"dotnet-loh-fragmentation",
	"jvm-metaspace-leak",
	"nodejs-buffer-pool-exhaustion",
	// Cases 93-102: Load balancing and proxies
	"nginx-upstream-timeout",
	"haproxy-health-check-flap",
	"tcp-connection-reset-storm",
	"dns-ttl-cache-poisoning",
	"tls-handshake-timeout",
	"http2-stream-multiplexing",
	"bgp-route-leak",
	"mtu-path-discovery-failure",
	"load-balancer-sticky-session",
	"websocket-proxy-buffering",
	// Cases 103-111: Resilience patterns
	"circuit-breaker-half-open",
	"retry-storm-amplification",
	"bulkhead-isolation-breach",
	"saga-compensation-failure",
	"event-sourcing-projection-lag",
	"cqrs-command-validation",
	"idempotency-key-collision",
	"two-phase-commit-timeout",
	"optimistic-locking-conflict",
	// Cases 113-122: DevOps and deployment
	"ci-pipeline-cache-corruption",
	"blue-green-deployment-dns",
	"canary-release-metric-skew",
	"database-migration-lock",
	"feature-toggle-memory-leak",
	"config-hot-reload-race",
	"zero-downtime-deploy-failure",
	"terraform-state-corruption",
	"gitops-sync-conflict",
	"secret-rotation-failure",
];

/**
 * Get a case by ID.
 */
export function getCase(id: string): DetectiveCase | undefined {
	return cases[id];
}

/**
 * Get all cases as summaries (for listing).
 */
export function getAllCaseSummaries(): CaseSummary[] {
	return caseOrder.map((id) => {
		const c = cases[id];
		return {
			id: c.id,
			title: c.title,
			subtitle: c.subtitle,
			difficulty: c.difficulty,
			category: c.category,
			totalClues: c.clues.length,
		};
	});
}

/**
 * Get a case view with progressive clue reveal.
 * @param id Case ID
 * @param cluesRevealed Number of clues to reveal (1 to totalClues)
 */
export function getCaseView(id: string, cluesRevealed: number): CaseView | undefined {
	const c = cases[id];
	if (!c) return undefined;

	// Ensure cluesRevealed is within bounds
	const totalClues = c.clues.length;
	const revealed = Math.max(1, Math.min(cluesRevealed, totalClues));

	return {
		id: c.id,
		title: c.title,
		subtitle: c.subtitle,
		difficulty: c.difficulty,
		category: c.category,
		crisis: c.crisis,
		symptoms: c.symptoms,
		clues: c.clues.slice(0, revealed),
		totalClues,
		cluesRevealed: revealed,
	};
}

/**
 * Get the full solution for a case.
 */
export function getCaseSolution(id: string) {
	const c = cases[id];
	return c?.solution;
}
