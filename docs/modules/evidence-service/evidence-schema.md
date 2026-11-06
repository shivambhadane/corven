# Evidence schema (version 1)

```
{ schemaVersion, evidenceId, organizationId, incidentId, sequence,
  previous: { evidenceId, contentHash } | null,
  generatedAt, generatedBy: { id, type },
  incident:   { id, title, descriptionHash, severity, status, detectionSource, detectionReference,
                createdBy, createdByType, createdAt, stateHistory[{ from, to, actorId, actorType, reasonHash, at }] },
  agents[], resources[],                      // incident associations
  identities[{ agentId, type, value, verificationStatus, chainId, verifiedAt }],
  analysis[{ referenceId, kind, version, snapshotId, snapshotHash, snapshotFormatVersion, engineVersion, resultHash, planHash, planStatus, at }],
  approvals[{ approvalId, status, planReferenceId, planHash, approvalDigest, schemaVersion, risk, requiredApprovals, requestedBy,
              createdAt, decidedAt, executableUntil, closedReasonHash,
              decisions[{ decidedBy, role, decision, planHash, approvalDigest, commentHash, at }] }],
  enforcement[{ actionId, kind, status, adapter, approvalBasis, approvalRef, planHash, edgeId, agentId, resourceId,
                failureReason, externalReference, requestedBy, requestedByType, history[{ status, actorType, at }] }],
  verification[{ runId, status, attempt, retryOf, approvalId, planHash, snapshotHash, resultHash, incidentOutcome, counts, completedAt }],
  timeline: { eventCount, timelineHash, events[{ id, sequence, type, actorId, actorType, at }] },
  notes: { count, contentHash },
  limitations[] }
```

## What is deliberately excluded

Free text is replaced by hashes (`descriptionHash`, `reasonHash`, `commentHash`, `closedReasonHash`, `notes.contentHash`, `timelineHash`): the incident description, transition reasons, approval comments, note text and timeline event payloads. Credentials, token material, payload contents and secret hashes are never read. The incident **title**, agent and resource ids, and the identifiers and hashes above are kept. Hashes of free text let a holder of the original text prove it matches, without disclosing it; a hash of short, guessable text can be brute-forced, so do not treat it as confidentiality for such text.

## Fixed meaning

Section contents are fixed by `schemaVersion`. A change to what is recorded requires a new version; old records stay verifiable against their own version (version 1 is the only one today).
