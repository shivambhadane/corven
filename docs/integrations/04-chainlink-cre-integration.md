# Chainlink CRE Integration

**Status: planned (design), and optional.** The PRD says to implement it only if it plays a meaningful role in an incident workflow and time allows. Cut it first if the schedule slips ([04-mvp-scope.md](../04-mvp-scope.md)). Nothing is implemented, and **the CRE SDK and workflow model have not been reviewed here**; confirm them against current Chainlink documentation before design is finalized.

## Purpose

Connect an external incident signal to a workflow that validates it and triggers a response, then records the result:

1. Receive an external incident signal.
2. Validate the signal.
3. Trigger the CRE workflow.
4. Call the appropriate on-chain response mechanism or the CORVEN API.
5. Record and verify the resulting status.

It must have a real role in CORVEN, not be a decorative integration.

## Open decision: direction

The PRD describes CRE calling "the on-chain response mechanism". The architecture model draws both CRE → contracts and CRE → backend API. Pick one (see [architecture/01-system-architecture.md](../architecture/01-system-architecture.md), decision 3). A suggested minimal role: the workflow **opens an incident** in CORVEN for a validated signal (CRE → API), leaving containment decisions deterministic and approved by a human; having an external workflow trigger enforcement directly is a larger trust decision.

## Adapter interface (proposed)

```ts
interface CreAdapter {
  verifyWorkflowResult(payload: unknown, signature: string): Promise<VerifiedSignal>;
}
```

The API exposes a narrowly scoped, authenticated ingestion endpoint; it accepts only results that pass signature or service-identity verification. An unauthenticated endpoint that lets any caller submit "trusted" signals is not acceptable.

## Rules

- Validate every response and signal; never trust payload fields for organization ownership.
- A signal creates an incident in state `detected`; it does not skip analysis or approval.
- Duplicate signals (same signal id) are ignored.
- A workflow failure is recorded and visible; it must not look like a successful response.
- The workflow cannot approve plans or change permissions by itself.

## Testing

Valid and invalid signatures, duplicate signal, malformed payload, workflow failure, replay, cross-organization attempts. Integration testing depends on CRE's local simulation tooling, which must be confirmed.

## To confirm before building

Whether CRE can be simulated locally for tests, its supported triggers and capabilities, and the cost and access constraints for the hackathon.
