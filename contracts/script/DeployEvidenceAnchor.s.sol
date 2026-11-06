// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {EvidenceAnchor} from "../src/EvidenceAnchor.sol";

/**
 * Deploys EvidenceAnchor. This script never reads a private key: the signer is supplied on the
 * command line by Foundry (a keystore account, hardware wallet or --private-key), so no key is
 * ever written to a file or a log.
 *
 *   Dry run (simulates, sends nothing, needs no key):
 *     EVIDENCE_ANCHOR_OWNER=0x... EVIDENCE_ANCHOR_SIGNER=0x... \
 *       forge script script/DeployEvidenceAnchor.s.sol --rpc-url "$ETHEREUM_SEPOLIA_RPC_URL"
 *
 *   Real deployment (only after explicit approval): add --broadcast and a signer option.
 *
 * It refuses to run anywhere except Sepolia (11155111) or a local Anvil chain (31337).
 */
contract DeployEvidenceAnchor is Script {
    error UnsupportedChain(uint256 chainId);

    function run() external returns (EvidenceAnchor deployed) {
        if (block.chainid != 11155111 && block.chainid != 31337) revert UnsupportedChain(block.chainid);
        address owner = vm.envAddress("EVIDENCE_ANCHOR_OWNER");
        address signer = vm.envAddress("EVIDENCE_ANCHOR_SIGNER");

        vm.startBroadcast();
        deployed = new EvidenceAnchor(owner, signer);
        vm.stopBroadcast();

        console2.log("EvidenceAnchor deployed at", address(deployed));
        console2.log("chainId", block.chainid);
        console2.log("owner", owner);
        console2.log("initial signer", signer);
    }
}
