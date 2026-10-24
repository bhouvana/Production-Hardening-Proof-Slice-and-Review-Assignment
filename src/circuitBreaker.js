'use strict';

class CircuitOpenError extends Error {
  constructor() {
    super('circuit is open');
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
  }
}

function createCircuitBreaker(options = {}) {
  const failureThreshold = options.failureThreshold ?? 0.5;
  const minimumRequests = options.minimumRequests ?? 5;
  const openMillis = options.openMillis ?? 30_000;
  const now = options.now ?? Date.now;
  const onStateChange = options.onStateChange ?? (() => {});

  if (!Number.isFinite(failureThreshold) || failureThreshold <= 0 || failureThreshold > 1) {
    throw new RangeError('failureThreshold must be in (0, 1]');
  }
  if (!Number.isInteger(minimumRequests) || minimumRequests < 1) {
    throw new RangeError('minimumRequests must be a positive integer');
  }
  if (!Number.isFinite(openMillis) || openMillis < 0) {
    throw new RangeError('openMillis must be a non-negative number');
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function');
  }
  if (typeof onStateChange !== 'function') {
    throw new TypeError('onStateChange must be a function');
  }

  const metrics = {
    breaker_open_total: 0,
    short_circuited_total: 0,
    success_total: 0,
    failure_total: 0,
  };

  let state = 'CLOSED';
  let calls = 0;
  let failures = 0;
  let openedAt = 0;
  let probeInFlight = false;

  function transition(nextState) {
    if (state === nextState) return;
    state = nextState;
    onStateChange(state);
  }

  function openCircuit() {
    openedAt = now();
    probeInFlight = false;
    metrics.breaker_open_total += 1;
    transition('OPEN');
  }

  async function exec(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('exec expects a function');
    }

    if (state === 'OPEN') {
      if (now() - openedAt < openMillis) {
        metrics.short_circuited_total += 1;
        throw new CircuitOpenError();
      }
      transition('HALF_OPEN');
    }

    if (state === 'HALF_OPEN') {
      if (probeInFlight) {
        metrics.short_circuited_total += 1;
        throw new CircuitOpenError();
      }

      probeInFlight = true;
      try {
        const result = await fn();
        metrics.success_total += 1;
        calls = 0;
        failures = 0;
        probeInFlight = false;
        transition('CLOSED');
        return result;
      } catch (error) {
        metrics.failure_total += 1;
        openCircuit();
        throw error;
      }
    }

    calls += 1;
    try {
      const result = await fn();
      metrics.success_total += 1;
      return result;
    } catch (error) {
      failures += 1;
      metrics.failure_total += 1;
      if (state === 'CLOSED' && calls >= minimumRequests && failures / calls >= failureThreshold) {
        openCircuit();
      }
      throw error;
    }
  }

  return {
    exec,
    metrics,
    get state() {
      return state;
    },
  };
}

module.exports = { createCircuitBreaker, CircuitOpenError };
