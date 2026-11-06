import { describe, expect, it } from "vitest";
import { EnsResolver } from "../src/modules/agent-registry/services/ens-resolver.js";
import type { PublicClient } from "viem";

describe("EnsResolver", () => {
  it("returns null for malformed or non-resolving names gracefully", async () => {
    const mockClient = {
      getEnsAddress: async () => null,
      getEnsName: async () => null,
    } as unknown as PublicClient;

    const resolver = new EnsResolver({ client: mockClient });
    const address = await resolver.resolveName("nonexistent-test-agent-corven.eth");
    expect(address).toBeNull();
  });

  it("resolves valid ENS name to checksummed EVM address", async () => {
    const testAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const mockClient = {
      getEnsAddress: async () => testAddr,
      getEnsName: async () => "agent.eth",
    } as unknown as PublicClient;

    const resolver = new EnsResolver({ client: mockClient });
    const address = await resolver.resolveName("agent.eth");
    expect(address).toBe(testAddr);
  });

  it("resolves EVM address to lowercase ENS name via reverse resolution", async () => {
    const testAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const mockClient = {
      getEnsAddress: async () => testAddr,
      getEnsName: async () => "Agent.ETH",
    } as unknown as PublicClient;

    const resolver = new EnsResolver({ client: mockClient });
    const name = await resolver.resolveAddress(testAddr);
    expect(name).toBe("agent.eth");
  });

  it("returns null for invalid EVM addresses in reverse resolution", async () => {
    const resolver = new EnsResolver({ client: {} as PublicClient });
    expect(await resolver.resolveAddress("not-an-address")).toBeNull();
    expect(await resolver.resolveAddress("0x123")).toBeNull();
  });

  it("verifies identity match when forward resolved address matches expected address", async () => {
    const testAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const mockClient = {
      getEnsAddress: async () => testAddr,
      getEnsName: async () => "agent.eth",
    } as unknown as PublicClient;

    const resolver = new EnsResolver({ client: mockClient });
    const res = await resolver.verifyIdentity("agent.eth", testAddr);
    expect(res.verified).toBe(true);
    expect(res.resolvedAddress).toBe(testAddr);
    expect(res.resolvedName).toBe("agent.eth");
    expect(res.match).toBe(true);
  });

  it("rejects verification when forward resolved address differs from expected address", async () => {
    const testAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const otherAddr = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const mockClient = {
      getEnsAddress: async () => testAddr,
      getEnsName: async () => "agent.eth",
    } as unknown as PublicClient;

    const resolver = new EnsResolver({ client: mockClient });
    const res = await resolver.verifyIdentity("agent.eth", otherAddr);
    expect(res.verified).toBe(false);
    expect(res.match).toBe(false);
  });

  it("handles unresolvable ENS names in verifyIdentity", async () => {
    const mockClient = {
      getEnsAddress: async () => null,
      getEnsName: async () => null,
    } as unknown as PublicClient;

    const resolver = new EnsResolver({ client: mockClient });
    const res = await resolver.verifyIdentity("unregistered.eth");
    expect(res.verified).toBe(false);
    expect(res.resolvedAddress).toBeNull();
    expect(res.error).toBe("Name does not resolve to an address");
  });
});
