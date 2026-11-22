import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyError,
  calculateBackoff,
  DEFAULT_RETRY_CONFIG,
  DeadLetterQueueStore,
  ResilientConsumerRunner,
} from '../../packages/messaging/src/resilience.ts';
import { InMemoryEventBus } from '../../packages/messaging/src/event-bus.ts';

describe('CF-023: Resilience, Retries and Dead-Letter Queue', () => {
  it('should calculate exponential backoff with upper bound correctly', () => {
    const config = {
      initialDelayMs: 100,
      maxDelayMs: 5000,
      maxAttempts: 5,
      backoffFactor: 2,
      enableJitter: false,
    };
    const delays = [0, 1, 2, 3, 4, 5, 6, 10].map(attempt =>
      calculateBackoff(attempt, config)
    );
    assert.deepEqual(delays, [100, 200, 400, 800, 1600, 3200, 5000, 5000]);
  });

  it('should classify transient and permanent errors accurately', () => {
    // Transient cases
    assert.equal(classifyError({ code: 'ECONNRESET' }), 'TRANSIENT');
    assert.equal(classifyError({ code: 'ETIMEDOUT' }), 'TRANSIENT');
    assert.equal(classifyError({ code: 'BUS_CLOSED' }), 'TRANSIENT');
    assert.equal(classifyError({ status: 503 }), 'TRANSIENT');
    assert.equal(classifyError({ status: 429 }), 'TRANSIENT');
    assert.equal(classifyError(new Error('Connection TIMEOUT to redis host')), 'TRANSIENT');

    // Permanent cases (poison pill / business validation / client error)
    assert.equal(classifyError({ status: 400 }), 'PERMANENT');
    assert.equal(classifyError({ status: 401 }), 'PERMANENT');
    assert.equal(classifyError({ status: 403 }), 'PERMANENT');
    assert.equal(classifyError({ status: 422 }), 'PERMANENT');
    assert.equal(classifyError({ code: 'VALIDATION_ERROR' }), 'PERMANENT');
    assert.equal(classifyError({ code: 'CONTRACT_VALIDATION_ERROR' }), 'PERMANENT');
    assert.equal(classifyError(new Error('SYNTAX_ERROR: unexpected token')), 'PERMANENT');
    assert.equal(classifyError(new Error('POISON_PILL: bad payload format')), 'PERMANENT');
  });

  it('should successfully process message after transient retries', async () => {
    const eventBus = new InMemoryEventBus();
    const dlq = new DeadLetterQueueStore();
    const runner = new ResilientConsumerRunner(eventBus, dlq, {
      maxAttempts: 4,
      initialDelayMs: 10,
      maxDelayMs: 50,
      backoffFactor: 2,
      enableJitter: false,
    });

    let attempts = 0;
    const envelope = {
      eventId: 'evt-transient-1',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { orderId: 'ord-123' },
      metadata: { correlationId: 'corr-1' },
    };

    const result = await runner.executeWithResilience(envelope, 'order.events', async () => {
      attempts++;
      if (attempts < 3) {
        const transientErr = new Error('Database connection TIMEOUT');
        (transientErr as any).code = 'ETIMEDOUT';
        throw transientErr;
      }
    });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.attempts, 3);
    assert.equal(dlq.getAllRecords().length, 0);
  });

  it('should immediately route poison pill (permanent error) to DLQ without retries', async () => {
    const eventBus = new InMemoryEventBus();
    const dlq = new DeadLetterQueueStore();
    const runner = new ResilientConsumerRunner(eventBus, dlq, {
      maxAttempts: 5,
      initialDelayMs: 10,
    });

    let handlerCalls = 0;
    const poisonEnvelope = {
      eventId: 'evt-poison-1',
      eventType: 'OrderCreated',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { malformed: true },
      metadata: { correlationId: 'corr-poison' },
    };

    const result = await runner.executeWithResilience(poisonEnvelope, 'order.events', async () => {
      handlerCalls++;
      const permanentErr = new Error('POISON_PILL: schema validation failed');
      (permanentErr as any).code = 'VALIDATION_ERROR';
      throw permanentErr;
    });

    assert.equal(result.status, 'DEAD_LETTERED');
    assert.equal(result.attempts, 1, 'Permanent error must NOT be retried');
    assert.equal(handlerCalls, 1);

    const deadLetters = dlq.getAllRecords();
    assert.equal(deadLetters.length, 1);
    assert.equal(deadLetters[0].originalMessageId, 'evt-poison-1');
    assert.equal(deadLetters[0].errorClassification, 'PERMANENT');
    assert.equal(deadLetters[0].retryAttempts, 1);
    assert.equal(deadLetters[0].status, 'PENDING_REVIEW');
  });

  it('should route transient error to DLQ once maxAttempts limit is exhausted', async () => {
    const eventBus = new InMemoryEventBus();
    const dlq = new DeadLetterQueueStore();
    const runner = new ResilientConsumerRunner(eventBus, dlq, {
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 30,
      backoffFactor: 2,
      enableJitter: false,
    });

    let handlerCalls = 0;
    const envelope = {
      eventId: 'evt-timeout-exhausted',
      eventType: 'PaymentRequested',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { amount: 500 },
      metadata: { correlationId: 'corr-timeout' },
    };

    const result = await runner.executeWithResilience(envelope, 'payment.events', async () => {
      handlerCalls++;
      const timeoutErr = new Error('Gateway 503 SERVICE_UNAVAILABLE');
      (timeoutErr as any).statusCode = 503;
      throw timeoutErr;
    });

    assert.equal(result.status, 'DEAD_LETTERED');
    assert.equal(result.attempts, 3);
    assert.equal(handlerCalls, 3);

    const deadLetters = dlq.getAllRecords();
    assert.equal(deadLetters.length, 1);
    assert.equal(deadLetters[0].originalMessageId, 'evt-timeout-exhausted');
    assert.equal(deadLetters[0].errorClassification, 'TRANSIENT');
    assert.equal(deadLetters[0].retryAttempts, 3);
  });

  it('should support dead-letter replay back into event bus', async () => {
    const eventBus = new InMemoryEventBus();
    const dlq = new DeadLetterQueueStore();
    const runner = new ResilientConsumerRunner(eventBus, dlq, { maxAttempts: 1 }, );

    const envelope = {
      eventId: 'evt-to-replay-999',
      eventType: 'InventoryReserved',
      version: 1,
      timestamp: new Date().toISOString(),
      payload: { sku: 'PROD-1', quantity: 2 },
      metadata: { correlationId: 'corr-replay' },
    };

    // First, process fails with permanent error and routes to DLQ
    await runner.executeWithResilience(envelope, 'inventory.events', async () => {
      throw new Error('POISON_PILL: target downstream temporary schema unaligned');
    });

    const pending = dlq.getPendingRecords();
    assert.equal(pending.length, 1);
    const dlqId = pending[0].id;

    // Listen to EventBus for replay
    const replayedEvents: any[] = [];
    eventBus.subscribe('inventory.events', async (e) => {
      replayedEvents.push(e);
    });

    // Replay message
    const replaySuccess = await runner.replayMessage(dlqId);
    assert.equal(replaySuccess, true);
    assert.equal(replayedEvents.length, 1);
    assert.equal(replayedEvents[0].eventId, 'evt-to-replay-999');
    assert.equal(replayedEvents[0].payload.sku, 'PROD-1');

    // Verify record marked as REPLAYED
    const record = dlq.getRecord(dlqId);
    assert.equal(record?.status, 'REPLAYED');
    assert.notEqual(record?.replayedAt, undefined);
    assert.equal(dlq.getPendingRecords().length, 0);
  });
});
