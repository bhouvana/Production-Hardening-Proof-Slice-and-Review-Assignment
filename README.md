# PromptPilot Circuit Breaker — Production Safety Proof Slice

## Risk addressed
PromptPilot calls an external model provider to draft support replies. When the provider is failing or slow, repeated doomed calls consume request capacity and can cascade into user-visible delays. This slice short-circuits calls after sustained failures and leaves the reply service able to return its safe fallback.

## Chosen control
A circuit breaker with `CLOSED`, `OPEN`, and `HALF_OPEN` states. In `CLOSED`, it evaluates the failure ratio only after the minimum request volume. In `OPEN`, it rejects calls without invoking the provider until the open window expires. In `HALF_OPEN`, only one recovery probe is allowed; success closes and resets the breaker, while failure reopens it.

## How to run / test
Requires Node.js 18 or newer. From the repository root:

```bash
node --test
```

The supplied tests are unchanged and cover the circuit-breaker state transitions and the integration with the reply fallback.

## Evidence
The test suite checks that the breaker stays closed below the minimum request volume, opens when the threshold is met, short-circuits without calling the dependency while open, permits recovery after the timeout, reopens after a failed probe, emits state changes, and returns the configured fallback when the provider remains unavailable.

## Observability note
Inspect `metrics.breaker_open_total`, `metrics.short_circuited_total`, `metrics.success_total`, and `metrics.failure_total`. Provide `onStateChange(state)` to collect transitions such as `OPEN`, `HALF_OPEN`, and `CLOSED`. These counters are process-local and should be exported by the host service if fleet-wide visibility is needed.

## Trade-off
During an outage, some requests receive a safe queued-for-human fallback instead of a model-generated response. This intentionally favours service availability and controlled degradation over attempting every provider request.

## Remaining risk
This implementation is process-local, not a distributed breaker; multiple instances maintain independent state. It does not itself cancel or time out a hung provider call, enforce a global concurrency limit, or guarantee fallback suitability for every ticket. The provider client should still have explicit timeouts and suitable retry limits.

## How this production control protects my Modules 1–3 design
It protects the support-reply path from a single external model dependency becoming a cascading failure. When the provider is unhealthy, the application returns its existing safe fallback instead of repeatedly calling a failing dependency, preserving a predictable user-facing path.
