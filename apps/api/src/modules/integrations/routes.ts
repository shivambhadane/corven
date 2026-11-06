import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { AppError } from "../../errors.js";
import type { EvidenceConfig } from "../evidence-service/index.js";
import { WindowLimiter } from "../demo/routes.js";

export type IntegrationState = "configured" | "not_configured" | "disabled" | "not_implemented";

/** What the integrations page needs from ENS: forward resolution only. ENS names identities; it never grants or revokes anything. */
export interface EnsLookup {
  readonly network: string;
  resolveName(name: string): Promise<string | null>;
}

export interface IntegrationsOptions {
  evidence: EvidenceConfig;
  ethereumState?: { state: IntegrationState; reason?: string | undefined } | undefined;
  ens?: EnsLookup | null | undefined;
}

const EnsBody = Type.Object({ name: Type.String({ minLength: 3, maxLength: 255, pattern: "^[^\\s]+\\.[^\\s]+$" }) }, { additionalProperties: false });

/**
 * Honest status of each sponsor technology. Never includes keys, RPC URLs or signer secrets; "configured" means the
 * server has what it needs, not that the last operation succeeded (the evidence pages show actual anchor outcomes).
 */
export const integrationRoutes: FastifyPluginAsyncTypebox<IntegrationsOptions> = async (app, { evidence, ethereumState, ens }) => {
  const ensLimiter = new WindowLimiter(30, 60_000);

  app.get("/integrations", async (_req, reply) => {
    void reply.header("cache-control", "no-store");
    const eth = evidence.ethereum;
    return {
      data: {
        arkiv: {
          purpose: "Stores each sealed incident evidence record as a structured entity and reads it back to check it matches.",
          state: evidence.arkiv ? "configured" : (evidence.arkivState?.state ?? "not_configured"),
          network: "Arkiv Rabdi DB-Chain testnet",
          reason: evidence.arkiv ? null : (evidence.arkivState?.reason ?? "No Arkiv client is configured"),
        },
        ethereum: {
          purpose: "Anchors the evidence hash in a transaction to the EvidenceAnchor contract; counted only after the required confirmations.",
          state: eth ? "configured" : (ethereumState?.state ?? "not_configured"),
          network: eth ? (eth.chainId === 11155111 ? "Ethereum Sepolia" : `chain ${eth.chainId}`) : "Ethereum Sepolia",
          contractAddress: eth?.contractAddress ?? null,
          requiredConfirmations: evidence.requiredConfirmations,
          reason: eth ? null : (ethereumState?.reason ?? "No Ethereum client is configured"),
        },
        ens: {
          purpose: "Resolves human-readable names for agent identities. It does not authenticate agents or change permissions.",
          state: ens ? "configured" : "not_configured",
          network: ens?.network ?? "Ethereum Sepolia",
          reason: ens ? null : "No Ethereum RPC is configured for ENS resolution",
        },
        chainlinkCre: {
          purpose: "Planned: coordinate an external workflow (for example, notifying an on-chain consumer) after CORVEN's own approval and enforcement.",
          state: "not_implemented",
          network: null,
          reason: "No Chainlink CRE workflow exists in this build. Nothing is simulated in its place.",
        },
      },
    };
  });

  app.post("/integrations/ens/resolve", { schema: { body: EnsBody } }, async (req) => {
    if (!ens) throw new AppError(503, "ENS_NOT_CONFIGURED", "ENS resolution is not configured on this server");
    if (!ensLimiter.take(req.principal.organizationId)) throw new AppError(429, "RATE_LIMITED", "Too many lookups; try again in a minute");
    const name = req.body.name.trim().toLowerCase();
    try {
      const address = await ens.resolveName(name);
      return { data: { name, network: ens.network, address, resolved: address !== null } };
    } catch {
      throw new AppError(502, "ENS_UNAVAILABLE", "The ENS lookup failed. The network may be unreachable; try again.");
    }
  });
};
