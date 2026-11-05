import type { Principal } from "./principal.js";

/**
 * Fixed audit identity for dependency changes made by the discovery pipeline.
 * It appears as actor_id in versions and audit rows so automated changes are
 * distinguishable from human ones.
 */
export const DISCOVERY_ACTOR_ID = "00000000-0000-4000-8000-00000000d15c";

/**
 * Builds an internal principal. Never construct this from request data: the
 * HTTP authenticators only ever return human roles, and a test asserts that
 * "x-dev-role: system" is rejected.
 */
export const systemPrincipal = (organizationId: string, actorId: string = DISCOVERY_ACTOR_ID): Principal => ({
  actorId,
  organizationId,
  role: "system",
});
