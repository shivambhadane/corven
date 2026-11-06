import { createConfig, http, injected, mock } from "wagmi";
import { hardhat, sepolia } from "wagmi/chains";
import { APP_CHAIN, IS_LOCAL_CHAIN, RPC_URL, galileo } from "./chain";

// Hardhat account #3: unlocked on the local node, which signs for it — no key in the browser.
// It only works against the local chain, so it's labelled as a test account in the UI.
export const LOCAL_TEST_ACCOUNT = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;

const CONNECTED_KEY = "localTestAccount.connected";

/** wagmi's mock connector, plus a stored flag so the test account stays connected across reloads. */
function localTestAccount() {
  const connectorFn = mock({ accounts: [LOCAL_TEST_ACCOUNT], features: { reconnect: true } });
  return ((config) => {
    const connector = connectorFn(config);
    const { connect, disconnect } = connector;
    connector.connect = async function (this: typeof connector, params?: Parameters<typeof connect>[0]) {
      const result = await connect.call(this, params);
      await config.storage?.setItem(CONNECTED_KEY, true);
      return result;
    } as typeof connect;
    connector.disconnect = async function (this: typeof connector) {
      await disconnect.call(this);
      await config.storage?.removeItem(CONNECTED_KEY);
    };
    connector.isAuthorized = async () => Boolean(await config.storage?.getItem(CONNECTED_KEY));
    return connector;
  }) as typeof connectorFn;
}

export const config = createConfig({
  chains: [APP_CHAIN],
  // the test account only exists on the local chain (its node holds the key)
  connectors: IS_LOCAL_CHAIN ? [injected({ shimDisconnect: true }), localTestAccount()] : [injected({ shimDisconnect: true })],
  // only APP_CHAIN is used; every supported chain is listed because the chain is chosen at build time
  transports: {
    [hardhat.id]: http(APP_CHAIN.id === hardhat.id ? RPC_URL : "http://127.0.0.1:8545"),
    [sepolia.id]: http(APP_CHAIN.id === sepolia.id ? RPC_URL : sepolia.rpcUrls.default.http[0]),
    [galileo.id]: http(APP_CHAIN.id === galileo.id ? RPC_URL : galileo.rpcUrls.default.http[0]),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
