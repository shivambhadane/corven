// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployEvidenceAnchor} from "../script/DeployEvidenceAnchor.s.sol";
import {EvidenceAnchor} from "../src/EvidenceAnchor.sol";

contract DeployEvidenceAnchorTest is Test {
    /// One test on purpose: environment variables are process-wide, so two tests that set them would race.
    function test_deployScript_localDeploymentWorks_andEveryOtherChainIsRefused() public {
        address owner = makeAddr("owner");
        address signer = makeAddr("signer");
        vm.setEnv("EVIDENCE_ANCHOR_OWNER", vm.toString(owner));
        vm.setEnv("EVIDENCE_ANCHOR_SIGNER", vm.toString(signer));
        DeployEvidenceAnchor d = new DeployEvidenceAnchor();

        vm.chainId(31337); // local Anvil
        EvidenceAnchor a = d.run();
        assertEq(a.owner(), owner);
        assertTrue(a.isSigner(signer));

        uint256[4] memory refused = [uint256(1), 10, 8453, 17000]; // mainnet, OP, Base, Holesky
        for (uint256 i = 0; i < refused.length; i++) {
            vm.chainId(refused[i]);
            vm.expectRevert(abi.encodeWithSelector(DeployEvidenceAnchor.UnsupportedChain.selector, refused[i]));
            d.run();
        }
    }
}
