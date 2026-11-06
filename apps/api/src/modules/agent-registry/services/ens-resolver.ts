import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  type Address,
  type PublicClient,
  type Transport,
} from "viem";
import { mainnet, sepolia } from "viem/chains";
import { normalize } from "viem/ens";

export interface EnsResolverConfig {
  /** Optional RPC URL (defaults to public endpoint or custom transport). */
  rpcUrl?: string | undefined;
  /** Chain to resolve on (default: sepolia for development/testing). */
  chain?: "mainnet" | "sepolia" | undefined;
  /** Custom transport for tests or mock HTTP providers. */
  transport?: Transport | undefined;
  /** Existing public client instance if already instantiated. */
  client?: PublicClient | undefined;
}

export interface EnsVerificationResult {
  verified: boolean;
  resolvedAddress: string | null;
  resolvedName: string | null;
  match: boolean;
  error?: string | undefined;
}

/**
 * Resolves ENS identities and verifies forward/reverse resolution.
 *
 * Designed to separate identity resolution from authorization:
 * ENS provides identity naming; it does not grant permissions or control external resources.
 */
export class EnsResolver {
  private readonly client: PublicClient;

  constructor(cfg: EnsResolverConfig = {}) {
    if (cfg.client) {
      this.client = cfg.client;
    } else {
      const selectedChain = cfg.chain === "mainnet" ? mainnet : sepolia;
      const transport = cfg.transport ?? http(cfg.rpcUrl, { timeout: 15_000, retryCount: 1 });
      this.client = createPublicClient({
        chain: selectedChain,
        transport,
      });
    }
  }

  /**
   * Forward resolution: resolves an ENS name (e.g. "agent.eth") to an EVM address.
   * Returns null if the name has no resolver or address record.
   */
  async resolveName(name: string): Promise<Address | null> {
    try {
      const normalized = normalize(name.trim().toLowerCase());
      const address = await this.client.getEnsAddress({ name: normalized });
      return address ? getAddress(address) : null;
    } catch {
      return null;
    }
  }

  /**
   * Reverse resolution: resolves an EVM address to its primary ENS name.
   * Returns null if no reverse record exists.
   */
  async resolveAddress(address: string): Promise<string | null> {
    if (!isAddress(address)) return null;
    try {
      const name = await this.client.getEnsName({ address: getAddress(address) });
      return name ? name.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  /**
   * Bi-directional verification:
   * 1. Resolves `ensName` to an address.
   * 2. Checks if `resolvedAddress` matches `expectedAddress`.
   * 3. Optionally checks reverse resolution for primary name consistency.
   */
  async verifyIdentity(ensName: string, expectedAddress?: string): Promise<EnsVerificationResult> {
    try {
      const resolvedAddress = await this.resolveName(ensName);
      if (!resolvedAddress) {
        return {
          verified: false,
          resolvedAddress: null,
          resolvedName: null,
          match: false,
          error: "Name does not resolve to an address",
        };
      }

      let match = true;
      if (expectedAddress) {
        if (!isAddress(expectedAddress)) {
          return {
            verified: false,
            resolvedAddress,
            resolvedName: null,
            match: false,
            error: "Expected address is invalid",
          };
        }
        match = getAddress(expectedAddress) === resolvedAddress;
      }

      const reverseName = await this.resolveAddress(resolvedAddress);

      return {
        verified: match,
        resolvedAddress,
        resolvedName: reverseName,
        match,
      };
    } catch (e) {
      return {
        verified: false,
        resolvedAddress: null,
        resolvedName: null,
        match: false,
        error: (e as Error).message || "Resolution failed",
      };
    }
  }
}
