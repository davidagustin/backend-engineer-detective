import { DetectiveCase } from '../../types';

export const twoPhaseCommitTimeout: DetectiveCase = {
  id: 'two-phase-commit-timeout',
  title: 'The Two-Phase Commit Timeout',
  subtitle: 'Coordinator crash leaving participants locked in prepared state',
  difficulty: 'senior',
  category: 'distributed',

  crisis: {
    description: `
      Your distributed database uses two-phase commit for cross-shard transactions. The
      transaction coordinator crashed during the commit phase. Now three database shards
      are stuck with prepared transactions holding locks on critical tables. New writes
      are blocked, queries timing out, and the system cannot determine whether to commit
      or rollback the prepared transactions.
    `,
    impact: `
      Three database shards locked for 2 hours. All write operations to affected tables
      blocked. Read replicas serving stale data. $300K in blocked transactions. Manual
      intervention required by DBA team.
    `,
    timeline: [
      { time: '2:00 PM', event: 'Large batch transaction initiated across 3 shards', type: 'normal' },
      { time: '2:01 PM', event: 'All participants respond PREPARED', type: 'normal' },
      { time: '2:01:30 PM', event: 'Coordinator begins sending COMMIT', type: 'normal' },
      { time: '2:01:31 PM', event: 'Coordinator crashes after commit to shard 1', type: 'critical' },
      { time: '2:01:32 PM', event: 'Shards 2 and 3 stuck in PREPARED state', type: 'critical' },
      { time: '2:15 PM', event: 'Lock timeout alerts firing', type: 'critical' },
      { time: '4:00 PM', event: 'Manual resolution completed', type: 'normal' },
    ]
  },

  symptoms: {
    working: [
      'Shard 1 committed successfully',
      'Read replicas returning data (stale)',
      'New transactions to unaffected tables work',
      'Coordinator restart successful'
    ],
    broken: [
      'Shards 2 and 3 have locked tables',
      'New writes to affected tables blocked',
      'Prepared transactions visible but not resolvable',
      'Coordinator has no record of in-flight transaction'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Transaction Coordinator Logs',
      type: 'logs',
      content: `
\`\`\`
# Coordinator logs before crash

[14:01:00.000] TXN-5847: Starting 2PC for batch update
[14:01:00.100] TXN-5847: Sending PREPARE to shard-1, shard-2, shard-3
[14:01:00.500] TXN-5847: shard-1 responded PREPARED
[14:01:00.600] TXN-5847: shard-2 responded PREPARED
[14:01:00.700] TXN-5847: shard-3 responded PREPARED
[14:01:00.701] TXN-5847: All participants PREPARED, beginning COMMIT phase
[14:01:00.800] TXN-5847: Sending COMMIT to shard-1
[14:01:00.900] TXN-5847: shard-1 COMMITTED
[14:01:00.901] TXN-5847: Sending COMMIT to shard-2

--- CRASH: Out of memory ---

# Coordinator state after restart
[14:05:00.000] Coordinator restarted
[14:05:00.100] Recovering in-flight transactions...
[14:05:00.200] No transaction log entries found for TXN-5847
[14:05:00.300] Recovery complete. 0 transactions recovered.

# The coordinator lost all memory of TXN-5847
# It doesn't know shards 2 and 3 are waiting for COMMIT/ROLLBACK
\`\`\`
      `,
      hint: 'Coordinator has no record of the transaction after restart'
    },
    {
      id: 2,
      title: 'Participant (Shard) Status',
      type: 'logs',
      content: `
\`\`\`sql
-- Query prepared transactions on shard-2

SELECT * FROM pg_prepared_xacts;

 transaction |  gid           |           prepared            | owner
-------------+----------------+-------------------------------+-------
 12847593    | txn_5847_s2    | 2024-01-15 14:01:00.650      | app

-- This prepared transaction is holding locks

SELECT * FROM pg_locks WHERE transactionid = 12847593;

 locktype      | relation | mode          | granted
---------------+----------+---------------+---------
 transactionid | -        | ExclusiveLock | t
 relation      | orders   | RowExclusive  | t
 relation      | inventory| RowExclusive  | t
 tuple         | orders   | ExclusiveLock | t

-- 847 rows locked in orders table
-- 234 rows locked in inventory table
-- All writes to these tables blocked since 14:01
\`\`\`
      `,
      hint: 'Prepared transaction holding locks on critical tables for 2 hours'
    },
    {
      id: 3,
      title: 'Two-Phase Commit Implementation',
      type: 'code',
      content: `
\`\`\`typescript
// coordinator/src/two-phase-commit.ts

class TwoPhaseCommitCoordinator {
  async executeTransaction(
    shards: Shard[],
    operations: Operation[]
  ): Promise<void> {
    const txnId = generateTransactionId();

    // Phase 1: Prepare
    const prepareResults = await Promise.all(
      shards.map(shard => shard.prepare(txnId, operations))
    );

    if (prepareResults.every(r => r.status === 'PREPARED')) {
      // Phase 2: Commit
      // NOTE: No durable log write before committing!
      for (const shard of shards) {
        await shard.commit(txnId);  // Sequential, not atomic
        // If we crash here, some shards committed, some didn't
      }
    } else {
      // Rollback
      await Promise.all(shards.map(s => s.rollback(txnId)));
    }
  }
}

// PROBLEM: No transaction log
// If coordinator crashes after PREPARE but before all COMMITs:
// - Some shards committed
// - Some shards still PREPARED
// - Coordinator has no record to recover from
\`\`\`
      `,
      hint: 'No durable transaction log - coordinator state is only in memory'
    },
    {
      id: 4,
      title: 'The Missing Transaction Log',
      type: 'testimony',
      content: `
"Classic 2PC requires the coordinator to durably log its decision BEFORE sending
commit messages. This is the 'presumed abort' or 'presumed commit' protocol.

Our implementation skipped the log write 'for performance'. The thought was:
'We'll just re-run failed transactions.'

But 2PC doesn't work that way. Once participants are PREPARED, they've promised
to either COMMIT or ROLLBACK based on the coordinator's decision. They hold
locks until they hear back.

When our coordinator crashed:
1. Shard 1 got COMMIT and committed
2. Shards 2 and 3 are PREPARED but never got COMMIT or ROLLBACK
3. They're blocking, waiting for a decision that will never come
4. The coordinator restarted with no memory of TXN-5847
5. Shards can't independently decide - they might disagree with shard 1

Without the transaction log, we have no way to know if the decision was COMMIT
or ROLLBACK. We can query shard 1 to see it committed, but that's a manual
recovery process, not automatic."
      `
    },
    {
      id: 5,
      title: 'Lock Blocking Analysis',
      type: 'metrics',
      content: `
\`\`\`
# Impact of prepared transaction locks

## Shard-2 Lock Wait Analysis

Blocked queries: 2,847
Average wait time: 45 minutes
Longest wait: 1 hour 58 minutes

Blocked operations:
- INSERT INTO orders: 1,234 blocked
- UPDATE inventory: 892 blocked
- SELECT FOR UPDATE: 721 blocked

## Connection Pool Exhaustion

Active connections: 200/200 (all waiting on locks)
Connection wait queue: 500+ requests

## Application Impact

Checkout failures: 100%
Order creation: 0% success
Inventory updates: 0% success

# The prepared transaction is blocking ALL writes
# to the affected tables system-wide
\`\`\`
      `,
      hint: 'Single prepared transaction blocking all operations to those tables'
    },
    {
      id: 6,
      title: 'Manual Resolution Options',
      type: 'code',
      content: `
\`\`\`sql
-- DBA options for resolving stuck prepared transactions

-- Option 1: Commit the prepared transaction (if we know decision was COMMIT)
-- Requires knowing the transaction should have committed
COMMIT PREPARED 'txn_5847_s2';

-- Option 2: Rollback the prepared transaction (if we know decision was ABORT)
-- Requires knowing the transaction should have rolled back
ROLLBACK PREPARED 'txn_5847_s2';

-- THE PROBLEM:
-- We DON'T know what the decision was!
-- Shard 1 committed, but coordinator has no record

-- Option 3: Query other shards to infer decision
-- If ANY shard committed, decision must have been COMMIT
-- Check shard-1:
SELECT committed FROM transaction_outcomes WHERE txn_id = 'txn_5847';
-- Result: committed = TRUE

-- So we should COMMIT on shards 2 and 3:
-- shard-2: COMMIT PREPARED 'txn_5847_s2';
-- shard-3: COMMIT PREPARED 'txn_5847_s3';

-- But this is MANUAL RECOVERY
-- Production 2PC should handle this automatically
\`\`\`
      `,
      hint: 'Manual recovery required because automatic recovery impossible without log'
    }
  ],

  solution: {
    diagnosis: 'Coordinator crashed without durable transaction log, leaving participants unable to resolve prepared transactions',

    keywords: [
      'two-phase commit', '2pc', 'coordinator', 'prepared transaction', 'transaction log',
      'distributed transaction', 'lock', 'presumed abort', 'recovery', 'blocking'
    ],

    rootCause: `
      The two-phase commit implementation had a critical flaw: the coordinator did not
      durably log its commit decision before sending commit messages to participants.

      Correct 2PC protocol requires:
      1. Coordinator receives all PREPARED responses
      2. Coordinator writes decision to DURABLE LOG
      3. Coordinator sends COMMIT (or ROLLBACK) to all participants
      4. Participants execute and acknowledge
      5. Coordinator marks transaction complete in log

      Our implementation skipped step 2. When the coordinator crashed after sending
      COMMIT to shard 1 but before shards 2 and 3:

      - Shard 1: Received COMMIT, committed
      - Shard 2: PREPARED, waiting for decision, holding locks
      - Shard 3: PREPARED, waiting for decision, holding locks
      - Coordinator: Restarted with no memory of transaction

      The participants are in "blocking" state - they cannot unilaterally decide to
      commit or rollback because they don't know what the coordinator decided. They
      must wait for the coordinator to tell them, but the coordinator doesn't remember.

      This is the fundamental weakness of 2PC - a coordinator failure during the commit
      phase can block participants indefinitely without a durable transaction log.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Correct 2PC with durable transaction log',
        code: `// coordinator/src/two-phase-commit.ts
class TwoPhaseCommitCoordinator {
  constructor(
    private transactionLog: DurableTransactionLog,
    private shards: Shard[]
  ) {}

  async executeTransaction(operations: Operation[]): Promise<void> {
    const txnId = generateTransactionId();

    // Log transaction start
    await this.transactionLog.write({
      txnId,
      state: 'STARTED',
      participants: this.shards.map(s => s.id),
      operations
    });

    try {
      // Phase 1: Prepare
      const prepareResults = await Promise.all(
        this.shards.map(shard => shard.prepare(txnId, operations))
      );

      if (prepareResults.every(r => r.status === 'PREPARED')) {
        // CRITICAL: Log decision BEFORE sending commits
        await this.transactionLog.write({
          txnId,
          state: 'COMMITTING',
          decision: 'COMMIT'
        });

        // Phase 2: Commit
        await Promise.all(
          this.shards.map(shard => shard.commit(txnId))
        );

        // Log completion
        await this.transactionLog.write({
          txnId,
          state: 'COMMITTED'
        });
      } else {
        // Log abort decision
        await this.transactionLog.write({
          txnId,
          state: 'ABORTING',
          decision: 'ABORT'
        });

        await Promise.all(
          this.shards.map(s => s.rollback(txnId))
        );

        await this.transactionLog.write({
          txnId,
          state: 'ABORTED'
        });
      }
    } catch (error) {
      // Error during prepare - abort
      await this.transactionLog.write({
        txnId,
        state: 'ABORTING',
        decision: 'ABORT',
        error: error.message
      });

      await Promise.all(
        this.shards.map(s => s.rollback(txnId).catch(() => {}))
      );

      throw error;
    }
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Coordinator recovery from transaction log',
        code: `// coordinator/src/recovery.ts
class CoordinatorRecovery {
  async recover(): Promise<void> {
    // Find all incomplete transactions in log
    const incomplete = await this.transactionLog.findIncomplete();

    for (const txn of incomplete) {
      await this.recoverTransaction(txn);
    }
  }

  private async recoverTransaction(txn: TransactionLogEntry): Promise<void> {
    switch (txn.state) {
      case 'STARTED':
      case 'ABORTING':
        // Never reached commit decision - safe to abort
        await this.rollbackParticipants(txn);
        await this.transactionLog.write({
          txnId: txn.txnId,
          state: 'ABORTED'
        });
        break;

      case 'COMMITTING':
        // Decision was COMMIT - complete the commit
        await this.commitParticipants(txn);
        await this.transactionLog.write({
          txnId: txn.txnId,
          state: 'COMMITTED'
        });
        break;

      case 'COMMITTED':
      case 'ABORTED':
        // Already complete - clean up participants if needed
        await this.cleanupParticipants(txn);
        break;
    }
  }

  private async commitParticipants(txn: TransactionLogEntry): Promise<void> {
    // Retry commit to all participants until success
    for (const participantId of txn.participants) {
      let committed = false;
      while (!committed) {
        try {
          const shard = this.getShard(participantId);
          await shard.commit(txn.txnId);
          committed = true;
        } catch (error) {
          this.logger.warn(\`Retry commit to \${participantId}\`, error);
          await sleep(1000);
        }
      }
    }
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Participant timeout and coordinator query',
        code: `// participant/src/prepared-transaction-monitor.ts
class PreparedTransactionMonitor {
  private readonly PREPARED_TIMEOUT_MS = 60000; // 1 minute

  async monitorPreparedTransactions(): Promise<void> {
    while (true) {
      const prepared = await this.db.getPreparedTransactions();

      for (const txn of prepared) {
        const age = Date.now() - txn.preparedAt;

        if (age > this.PREPARED_TIMEOUT_MS) {
          await this.resolveStuckTransaction(txn);
        }
      }

      await sleep(10000);
    }
  }

  private async resolveStuckTransaction(txn: PreparedTransaction): Promise<void> {
    // Query coordinator for decision
    try {
      const decision = await this.coordinator.getTransactionDecision(txn.txnId);

      if (decision === 'COMMIT') {
        await this.db.commitPrepared(txn.gid);
        this.metrics.increment('prepared.resolved.commit');
      } else if (decision === 'ABORT') {
        await this.db.rollbackPrepared(txn.gid);
        this.metrics.increment('prepared.resolved.abort');
      } else {
        // Decision unknown - coordinator might be down
        // Escalate to operator
        await this.alerting.critical('PreparedTransactionStuck', {
          txnId: txn.txnId,
          age: Date.now() - txn.preparedAt,
          tables: txn.lockedTables
        });
      }
    } catch (error) {
      this.logger.error('Failed to resolve prepared transaction', error);
    }
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Consider Saga pattern for long-running transactions',
        code: `// For many use cases, Saga is better than 2PC

// 2PC: Blocking, synchronous, requires coordinator availability
// Saga: Non-blocking, async, eventually consistent

class OrderSaga {
  async execute(order: Order): Promise<void> {
    try {
      // Each step is a separate transaction
      // No global locks held

      // Step 1: Reserve inventory (local transaction)
      const reservation = await this.inventory.reserve(order.items);

      // Step 2: Charge payment (local transaction)
      const payment = await this.payment.charge(order.total);

      // Step 3: Create order (local transaction)
      const orderRecord = await this.orders.create(order);

      // All succeeded - done

    } catch (error) {
      // Compensate completed steps
      // Each compensation is also a local transaction
      await this.compensate(completedSteps);
      throw error;
    }
  }
}

// Benefits over 2PC:
// - No global locks - each service releases locks immediately
// - No single coordinator failure point
// - Works across heterogeneous systems
// - Better for long-running processes

// Tradeoffs:
// - Eventually consistent, not immediately consistent
// - Compensation logic must be correct
// - Temporary inconsistency visible to users`
      }
    ],

    prevention: [
      'Always use durable transaction log for 2PC coordinator',
      'Implement coordinator recovery to resolve in-doubt transactions',
      'Add participant timeout to query coordinator about stuck prepared transactions',
      'Monitor for long-lived prepared transactions',
      'Consider Saga pattern for cross-service transactions (avoids blocking)',
      'Use database-native distributed transaction support when possible',
      'Set appropriate prepared transaction timeouts at database level',
      'Have runbooks for manual resolution of stuck transactions'
    ],

    educationalInsights: [
      '2PC requires durable coordinator log - without it, participants can block forever',
      'The "prepare" promise means participant CANNOT unilaterally decide',
      'Coordinator crash during commit phase is the worst-case scenario for 2PC',
      '2PC trades availability for consistency - blocking is by design',
      'Saga pattern is often better for microservices (non-blocking)',
      'Manual resolution requires knowing what decision WOULD have been',
      'Prepared transaction locks block all other transactions to those rows',
      'Modern systems often prefer eventual consistency over blocking protocols'
    ]
  }
};
