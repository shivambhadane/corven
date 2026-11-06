import type { Authenticator } from "../../auth/principal.js";
import { DemoTokens, demoPrincipal } from "./token.js";

export { DemoTokens, demoActor, demoPrincipal, DEMO_PERSONAS, type DemoPersona } from "./token.js";
export { demoRoutes, WindowLimiter, DEMO_ORGANIZATION_NAME, DEMO_SESSION_SECONDS } from "./routes.js";
export { DEMO_AGENTS, DEMO_RESOURCES, seedDemo } from "./seed.js";

const header = (h: Record<string, string | string[] | undefined>, n: string) => {
  const v = h[n];
  return Array.isArray(v) ? v[0] : v;
};

/** `x-corven-demo: <token>` (+ optional `x-corven-demo-persona`) → a principal confined to that one sandbox organization. */
export const createDemoAuthenticator = (tokens: DemoTokens): Authenticator => (headers) => {
  const claims = tokens.verify(header(headers, "x-corven-demo"));
  return claims ? demoPrincipal(claims, header(headers, "x-corven-demo-persona")) : null;
};
