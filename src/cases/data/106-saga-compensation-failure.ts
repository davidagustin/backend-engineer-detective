import { DetectiveCase } from '../../types';

export const sagaCompensationFailure: DetectiveCase = {
  id: 'saga-compensation-failure',
  title: 'The Saga Compensation Nightmare',
  subtitle: 'Distributed transaction left in inconsistent state after compensation failures',
  difficulty: 'principal',
  category: 'distributed',

  crisis: {
    description: `
      Your e-commerce platform uses the saga pattern for distributed transactions across
      ordering, inventory, and payment services. After a network partition during checkout,
      orders are stuck in impossible states: customers were charged but inventory wasn't
      reserved, or inventory was reserved but no order exists. Compensation logic is failing,
      leaving data permanently inconsistent across services.
    `,
    impact: `
      2,847 orders in inconsistent states. $450K charged to customers without fulfillment.
      Inventory counts wrong causing overselling. Manual reconciliation estimated at 200 hours.
      Legal team involved due to consumer complaints.
    `,
    timeline: [
      { time: '3:00 PM', event: 'Network partition between services (5 minutes)', type: 'warning' },
      { time: '3:05 PM', event: 'Network recovered, saga compensations triggered', type: 'warning' },
      { time: '3:10 PM', event: 'Compensation failures detected', type: 'critical' },
      { time: '3:30 PM', event: 'Inconsistent orders discovered', type: 'critical' },
      { time: '4:00 PM', event: 'Manual intervention begins, scale of problem unclear', type: 'critical' },
      { time: '6:00 PM', event: '2,847 inconsistent orders identified', type: 'critical' },
    ]
  },

  symptoms: {
    working: [
      'Individual services functioning correctly',
      'New orders processing normally',
      'Saga orchestrator sending commands',
      'Services responding to saga commands'
    ],
    broken: [
      'Some orders charged but not created',
      'Some inventory reserved but order cancelled',
      'Compensation actions failing silently',
      'Saga states stuck in intermediate steps',
      'No clear record of what compensations were attempted'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Saga Orchestrator Code',
      type: 'code',
      content: `
\`\`\`typescript
// saga-orchestrator/src/order-saga.ts
class OrderSaga {
  async execute(order: Order): Promise<SagaResult> {
    try {
      // Step 1: Reserve inventory
      await this.inventoryService.reserve(order.items);

      // Step 2: Process payment
      await this.paymentService.charge(order.total, order.customerId);

      // Step 3: Create order record
      await this.orderService.create(order);

      // Step 4: Send confirmation
      await this.notificationService.sendConfirmation(order);

      return { success: true, orderId: order.id };
    } catch (error) {
      // Compensation on any failure
      await this.compensate(order, error);
      throw error;
    }
  }

  private async compensate(order: Order, error: Error): Promise<void> {
    // Try to undo all steps
    try {
      await this.paymentService.refund(order.customerId, order.total);
    } catch (e) {
      console.error('Refund failed:', e);
    }

    try {
      await this.inventoryService.release(order.items);
    } catch (e) {
      console.error('Release failed:', e);
    }
  }
}
\`\`\`
      `,
      hint: 'The compensation runs all steps regardless of which ones actually succeeded'
    },
    {
      id: 2,
      title: 'Saga State During Incident',
      type: 'logs',
      content: `
\`\`\`
# Order: ord_12345 - Customer charged twice
[3:02:00] SAGA_START order=ord_12345
[3:02:01] INVENTORY_RESERVE success
[3:02:02] PAYMENT_CHARGE success (charge_id=ch_abc)
[3:02:03] ORDER_CREATE timeout (network partition)
[3:02:08] SAGA_COMPENSATE triggered
[3:02:09] PAYMENT_REFUND timeout (network partition)
[3:02:14] SAGA_COMPENSATE retry
[3:02:15] PAYMENT_REFUND failed: charge_id not found (already refunded?)
[3:05:30] Network recovered
[3:05:31] PAYMENT_CHARGE retry (saga retry) - NEW charge_id=ch_def
[3:05:32] ORDER_CREATE success
[3:05:33] SAGA_COMPLETE

# Result: Customer charged TWICE (ch_abc + ch_def), only one order created

# Order: ord_12346 - Inventory reserved, no order, no charge
[3:02:10] SAGA_START order=ord_12346
[3:02:11] INVENTORY_RESERVE success
[3:02:12] PAYMENT_CHARGE timeout
[3:02:17] SAGA_COMPENSATE triggered
[3:02:18] INVENTORY_RELEASE timeout
[3:05:30] Network recovered
[3:05:31] SAGA_ABANDONED (max retries exceeded)

# Result: Inventory stuck as reserved, no order, no charge
\`\`\`
      `,
      hint: 'The saga doesnt track which steps succeeded before compensating'
    },
    {
      id: 3,
      title: 'Compensation Without State Tracking',
      type: 'code',
      content: `
\`\`\`typescript
// Problem: No tracking of which steps completed
private async compensate(order: Order, error: Error): Promise<void> {
  // BLINDLY tries to compensate ALL steps
  // What if payment never succeeded? Refund will fail or refund wrong charge
  // What if inventory was never reserved? Release will fail or release wrong items

  try {
    await this.paymentService.refund(order.customerId, order.total);
    // No idempotency key! Multiple compensation attempts = multiple refunds
  } catch (e) {
    console.error('Refund failed:', e);
    // Error swallowed! No record that compensation failed
    // No retry logic
    // No alert
  }

  try {
    await this.inventoryService.release(order.items);
  } catch (e) {
    console.error('Release failed:', e);
    // Same problems
  }

  // No persistent record of compensation state
  // If process crashes here, we don't know what was compensated
}
\`\`\`
      `,
      hint: 'Compensation doesnt know what to compensate and swallows errors'
    },
    {
      id: 4,
      title: 'Missing Idempotency',
      type: 'logs',
      content: `
\`\`\`
# Payment service logs showing duplicate charges

[3:02:02.100] ChargeRequest customer=cust_789 amount=$150.00
[3:02:02.200] ChargeSuccess charge_id=ch_abc customer=cust_789

[3:05:31.100] ChargeRequest customer=cust_789 amount=$150.00
[3:05:31.200] ChargeSuccess charge_id=ch_def customer=cust_789
# Same customer charged twice - no idempotency key to detect duplicate

# Inventory service logs showing orphaned reservations

[3:02:11.100] ReserveRequest order=ord_12346 items=[SKU_A:2, SKU_B:1]
[3:02:11.200] ReserveSuccess reservation_id=res_xyz

[3:02:18.100] ReleaseRequest order=ord_12346 items=[SKU_A:2, SKU_B:1]
[3:02:18.500] ReleaseTimeout - network unreachable

# Reservation res_xyz never released, inventory permanently locked
# No background job to reconcile orphaned reservations
\`\`\`
      `,
      hint: 'No idempotency keys means retries create duplicates'
    },
    {
      id: 5,
      title: 'Saga Pattern Best Practices (Violated)',
      type: 'testimony',
      content: `
"After analyzing the incident, here's what we got wrong:

1. NO STATE MACHINE: We didn't track saga state. Compensation didn't know
   which steps had actually completed before failing.

2. NO IDEMPOTENCY: Saga retries created duplicate charges because payment
   service had no idempotency key to detect retries.

3. SWALLOWED ERRORS: Compensation errors were logged but not tracked.
   We couldn't tell which compensations failed.

4. NO OUTBOX PATTERN: We didn't use transactional outbox for saga events.
   Network partition = lost events.

5. ALL-OR-NOTHING COMPENSATION: We tried to compensate everything instead
   of only what succeeded. Refunding a charge that didn't happen = error.

6. NO DEAD LETTER QUEUE: Failed saga steps weren't queued for retry.
   They just got logged and forgotten.

7. NO RECONCILIATION JOB: No background process to detect and fix
   inconsistent states. We found out from customer complaints.

This isn't a saga - it's a prayer."
      `
    },
    {
      id: 6,
      title: 'Order State Inconsistencies Found',
      type: 'metrics',
      content: `
\`\`\`
# Post-incident reconciliation report

Total orders during incident window: 5,234

Consistent states: 2,387 (45.6%)

Inconsistent states: 2,847 (54.4%)

Breakdown of inconsistencies:
- Charged but no order record: 892
- Charged twice, one order: 234
- Inventory reserved, no order, no charge: 567
- Order exists, no charge, no inventory: 421
- Charge refunded but inventory still reserved: 389
- Order cancelled but charge not refunded: 344

Financial impact:
- Duplicate charges: $35,100
- Charges without orders: $133,800
- Missing charges for shipped orders: $89,200
- Total discrepancy: $258,100

Inventory impact:
- Orphaned reservations: 1,823 items across 567 SKUs
- Oversold items (negative inventory): 234 items
- Ghost reservations (items don't exist): 45 items
\`\`\`
      `,
      hint: 'Massive inconsistencies across all dimensions - charges, orders, inventory'
    }
  ],

  solution: {
    diagnosis: 'Saga implementation lacked state tracking, idempotency, proper compensation logic, and failure recovery mechanisms',

    keywords: [
      'saga', 'compensation', 'distributed transaction', 'state machine', 'idempotency',
      'outbox pattern', 'dead letter queue', 'reconciliation', 'eventual consistency',
      'choreography', 'orchestration'
    ],

    rootCause: `
      The saga implementation had fundamental architectural flaws that made it impossible
      to maintain consistency during failures:

      1. **No State Machine**: The saga didn't track which steps completed. When failure
         occurred, compensation blindly tried to undo ALL steps, including ones that
         never happened (causing errors) or double-undoing steps (duplicate refunds).

      2. **No Idempotency**: Neither the saga nor the services used idempotency keys.
         Retries during network recovery created duplicate operations (double charges).

      3. **Swallowed Compensation Errors**: When compensation failed, errors were logged
         but not tracked or retried. The system "thought" compensation succeeded.

      4. **No Transactional Outbox**: Saga events weren't persisted transactionally.
         Network partition caused events to be lost, leaving sagas in unknown states.

      5. **No Recovery Mechanism**: No dead letter queue for failed steps, no background
         reconciliation job, no alerting on stuck sagas.

      The result: 54% of orders during the incident ended up in inconsistent states,
      requiring massive manual intervention.
    `,

    codeExamples: [
      {
        lang: 'typescript',
        description: 'Saga with proper state machine tracking',
        code: `// saga-orchestrator/src/order-saga.ts
enum SagaStep {
  PENDING = 'PENDING',
  INVENTORY_RESERVED = 'INVENTORY_RESERVED',
  PAYMENT_CHARGED = 'PAYMENT_CHARGED',
  ORDER_CREATED = 'ORDER_CREATED',
  COMPLETED = 'COMPLETED',
  COMPENSATING = 'COMPENSATING',
  COMPENSATED = 'COMPENSATED',
  FAILED = 'FAILED'
}

interface SagaState {
  sagaId: string;
  orderId: string;
  currentStep: SagaStep;
  completedSteps: SagaStep[];
  compensatedSteps: SagaStep[];
  stepResults: Record<string, any>;  // Store IDs for compensation
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

class OrderSaga {
  async execute(order: Order): Promise<SagaResult> {
    // Create persistent saga state
    const saga = await this.sagaStore.create({
      sagaId: generateId(),
      orderId: order.id,
      currentStep: SagaStep.PENDING,
      completedSteps: [],
      stepResults: {}
    });

    try {
      // Step 1: Reserve inventory
      saga.currentStep = SagaStep.INVENTORY_RESERVED;
      const reservation = await this.inventoryService.reserve(
        order.items,
        { idempotencyKey: \`\${saga.sagaId}-inventory\` }
      );
      saga.stepResults.reservationId = reservation.id;
      saga.completedSteps.push(SagaStep.INVENTORY_RESERVED);
      await this.sagaStore.update(saga);

      // Step 2: Process payment
      saga.currentStep = SagaStep.PAYMENT_CHARGED;
      const charge = await this.paymentService.charge(
        order.total,
        order.customerId,
        { idempotencyKey: \`\${saga.sagaId}-payment\` }
      );
      saga.stepResults.chargeId = charge.id;
      saga.completedSteps.push(SagaStep.PAYMENT_CHARGED);
      await this.sagaStore.update(saga);

      // ... continue with other steps

      saga.currentStep = SagaStep.COMPLETED;
      await this.sagaStore.update(saga);
      return { success: true };

    } catch (error) {
      await this.compensate(saga, error);
      throw error;
    }
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Proper compensation that only undoes completed steps',
        code: `private async compensate(saga: SagaState, error: Error): Promise<void> {
  saga.currentStep = SagaStep.COMPENSATING;
  await this.sagaStore.update(saga);

  // Only compensate steps that ACTUALLY completed
  // Compensate in reverse order
  const stepsToCompensate = [...saga.completedSteps].reverse();

  for (const step of stepsToCompensate) {
    if (saga.compensatedSteps.includes(step)) {
      continue; // Already compensated
    }

    try {
      switch (step) {
        case SagaStep.PAYMENT_CHARGED:
          // Use stored chargeId - refund the EXACT charge
          await this.paymentService.refund(
            saga.stepResults.chargeId,
            { idempotencyKey: \`\${saga.sagaId}-refund\` }
          );
          break;

        case SagaStep.INVENTORY_RESERVED:
          // Use stored reservationId - release the EXACT reservation
          await this.inventoryService.release(
            saga.stepResults.reservationId,
            { idempotencyKey: \`\${saga.sagaId}-release\` }
          );
          break;

        case SagaStep.ORDER_CREATED:
          await this.orderService.cancel(
            saga.orderId,
            { idempotencyKey: \`\${saga.sagaId}-cancel\` }
          );
          break;
      }

      saga.compensatedSteps.push(step);
      await this.sagaStore.update(saga);

    } catch (compensationError) {
      // DON'T swallow - queue for retry
      await this.deadLetterQueue.push({
        sagaId: saga.sagaId,
        step,
        error: compensationError,
        retryCount: 0
      });

      // Alert on compensation failure
      await this.alerting.critical('SagaCompensationFailed', {
        sagaId: saga.sagaId,
        step,
        error: compensationError
      });
    }
  }

  saga.currentStep = saga.compensatedSteps.length === stepsToCompensate.length
    ? SagaStep.COMPENSATED
    : SagaStep.FAILED;
  await this.sagaStore.update(saga);
}`
      },
      {
        lang: 'typescript',
        description: 'Transactional outbox for reliable saga events',
        code: `// Use transactional outbox to ensure saga events are never lost
class TransactionalSagaOrchestrator {
  async executeStep(saga: SagaState, step: SagaStep): Promise<void> {
    await this.db.transaction(async (tx) => {
      // 1. Update saga state in same transaction as outbox
      await tx.sagaStore.update(saga);

      // 2. Write event to outbox table (same transaction)
      await tx.outbox.insert({
        id: generateId(),
        aggregateId: saga.sagaId,
        eventType: \`saga.\${step}\`,
        payload: JSON.stringify({
          sagaId: saga.sagaId,
          step,
          stepResults: saga.stepResults
        }),
        createdAt: new Date()
      });
    });

    // Outbox processor publishes events and deletes from outbox
    // If this fails, events stay in outbox for retry
  }
}

// Background job to process outbox
class OutboxProcessor {
  async process(): Promise<void> {
    const events = await this.db.outbox.findUnpublished({ limit: 100 });

    for (const event of events) {
      try {
        await this.eventBus.publish(event.eventType, event.payload);
        await this.db.outbox.markPublished(event.id);
      } catch (error) {
        // Leave in outbox for retry
        await this.db.outbox.incrementRetry(event.id);
      }
    }
  }
}`
      },
      {
        lang: 'typescript',
        description: 'Background reconciliation job',
        code: `// Reconciliation job to detect and fix stuck sagas
class SagaReconciliationJob {
  async run(): Promise<void> {
    // Find sagas stuck for more than 5 minutes
    const stuckSagas = await this.sagaStore.findStuck({
      olderThan: new Date(Date.now() - 5 * 60 * 1000),
      statuses: [SagaStep.COMPENSATING, SagaStep.PENDING]
    });

    for (const saga of stuckSagas) {
      await this.reconcileSaga(saga);
    }

    // Cross-service consistency check
    await this.crossServiceReconciliation();
  }

  private async crossServiceReconciliation(): Promise<void> {
    // Get all charges from payment service in last hour
    const charges = await this.paymentService.getRecentCharges({ hours: 1 });

    for (const charge of charges) {
      // Verify order exists for each charge
      const order = await this.orderService.findByChargeId(charge.id);

      if (!order) {
        // Orphaned charge - create incident
        await this.alerting.createIncident({
          type: 'ORPHANED_CHARGE',
          chargeId: charge.id,
          amount: charge.amount,
          customerId: charge.customerId,
          action: 'REVIEW_FOR_REFUND'
        });
      }
    }

    // Similarly check inventory reservations, etc.
  }
}`
      }
    ],

    prevention: [
      'Implement saga as explicit state machine with persistent state',
      'Store step results (charge IDs, reservation IDs) for targeted compensation',
      'Use idempotency keys for ALL saga operations to handle retries safely',
      'Use transactional outbox pattern to prevent lost events',
      'Only compensate steps that actually completed',
      'Queue failed compensations for retry instead of swallowing errors',
      'Implement background reconciliation to detect inconsistencies',
      'Set up alerting for stuck or failed sagas',
      'Design services to be queryable for reconciliation',
      'Document saga states and transitions for debugging'
    ],

    educationalInsights: [
      'Sagas require explicit state machines - implicit state leads to chaos',
      'Compensation must be targeted to exactly what was done, not blindly undo all',
      'Idempotency is non-negotiable for saga steps - retries will happen',
      'Transactional outbox ensures events survive crashes and partitions',
      'Swallowed errors in compensation are guaranteed data corruption',
      'Background reconciliation is your safety net when everything else fails',
      'A saga without proper compensation is just distributed corruption',
      'The harder case isnt success - its partial failure recovery'
    ]
  }
};
