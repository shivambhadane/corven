// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EvidenceAnchor} from "../src/EvidenceAnchor.sol";

contract EvidenceAnchorTest is Test {
    EvidenceAnchor internal anchor;

    address internal owner = makeAddr("owner");
    address internal signer = makeAddr("signer");
    address internal signer2 = makeAddr("signer2");
    address internal stranger = makeAddr("stranger");

    // Fixed 32-byte test values. (Not sha256(): as a constant it would be evaluated at each use as a precompile
    // CALL, which would consume a pending vm.prank / vm.expectRevert. The contract stores any 32 bytes as given;
    // test_anchor_preservesARealSha256 covers a real SHA-256.)
    bytes32 internal constant H1 = keccak256("canonical evidence document 1");
    bytes32 internal constant H2 = keccak256("canonical evidence document 2");
    bytes32 internal constant E1 = keccak256("corven.evidence.v1:11111111-1111-4111-8111-111111111111");
    bytes32 internal constant E2 = keccak256("corven.evidence.v1:22222222-2222-4222-8222-222222222222");
    bytes32 internal constant I1 = keccak256("corven.incident.v1:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    bytes32 internal constant I2 = keccak256("corven.incident.v1:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    event EvidenceAnchored(
        bytes32 indexed evidenceRef,
        bytes32 indexed incidentRef,
        bytes32 indexed evidenceHash,
        uint32 schemaVersion,
        uint32 sequence,
        address anchoredBy
    );
    event SignerUpdated(address indexed signer, bool authorized);

    function setUp() public {
        anchor = new EvidenceAnchor(owner, signer);
        vm.warp(1_800_000_000);
        vm.roll(1234);
    }

    function _anchor(bytes32 e, bytes32 i, bytes32 h, uint32 sv, uint32 seq) internal {
        vm.prank(signer);
        anchor.anchorEvidence(e, i, h, sv, seq);
    }

    // ------------------------------------------------------------------ setup

    function test_constructor_setsOwnerAndInitialSigner() public view {
        assertEq(anchor.owner(), owner);
        assertTrue(anchor.isSigner(signer));
        assertFalse(anchor.isSigner(owner)); // owning is not signing
        assertEq(anchor.anchorCount(), 0);
    }

    function test_constructor_canStartWithoutSigner() public {
        EvidenceAnchor a = new EvidenceAnchor(owner, address(0));
        assertFalse(a.isSigner(signer));
    }

    function test_constructor_rejectsZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new EvidenceAnchor(address(0), signer);
    }

    // ------------------------------------------------------------------ anchoring

    function test_anchor_storesExactlyWhatWasGiven() public {
        _anchor(E1, I1, H1, 1, 1);
        EvidenceAnchor.Anchor memory a = anchor.getAnchor(E1);
        assertEq(a.incidentRef, I1);
        assertEq(a.evidenceHash, H1); // the SHA-256 is preserved byte for byte
        assertEq(a.schemaVersion, 1);
        assertEq(a.sequence, 1);
        assertEq(a.anchoredBy, signer);
        assertEq(a.blockNumber, 1234);
        assertEq(a.timestamp, 1_800_000_000);
        assertEq(anchor.anchorCount(), 1);
        assertTrue(anchor.isAnchored(E1));
        assertEq(anchor.evidenceRefOfHash(H1), E1);
    }

    function test_anchor_preservesARealSha256() public {
        // The same input CORVEN hashes: SHA-256 of a canonical document. Whatever it is, it is stored byte for byte.
        bytes32 real = sha256(bytes('{"evidenceId":"x","incidentId":"y","schemaVersion":1}'));
        _anchor(E1, I1, real, 1, 1);
        assertTrue(anchor.verify(E1, real));
        assertEq(anchor.getAnchor(E1).evidenceHash, real);
    }

    function test_anchor_emitsEventWithAllReferences() public {
        vm.expectEmit(true, true, true, true, address(anchor));
        emit EvidenceAnchored(E1, I1, H1, 1, 3, signer);
        _anchor(E1, I1, H1, 1, 3);
    }

    function test_anchor_eventLogIsQueryableByEachIndexedField() public {
        vm.recordLogs();
        _anchor(E1, I1, H1, 1, 1);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].emitter, address(anchor));
        assertEq(logs[0].topics[0], EvidenceAnchored.selector);
        assertEq(logs[0].topics[1], E1);
        assertEq(logs[0].topics[2], I1);
        assertEq(logs[0].topics[3], H1);
    }

    // ------------------------------------------------------------------ authorization

    function test_anchor_revertsForStranger() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.NotAuthorizedSigner.selector, stranger));
        anchor.anchorEvidence(E1, I1, H1, 1, 1);
        assertFalse(anchor.isAnchored(E1));
    }

    function test_anchor_ownerIsNotImplicitlyASigner() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.NotAuthorizedSigner.selector, owner));
        anchor.anchorEvidence(E1, I1, H1, 1, 1);
    }

    function test_anchor_removedSignerCanNoLongerAnchor() public {
        vm.prank(owner);
        anchor.setSigner(signer, false);
        vm.prank(signer);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.NotAuthorizedSigner.selector, signer));
        anchor.anchorEvidence(E1, I1, H1, 1, 1);
    }

    function test_anchor_removalKeepsEarlierAnchors() public {
        _anchor(E1, I1, H1, 1, 1);
        vm.prank(owner);
        anchor.setSigner(signer, false);
        assertTrue(anchor.verify(E1, H1));
        assertEq(anchor.getAnchor(E1).anchoredBy, signer);
    }

    function test_anchor_secondSignerWorksAndIsRecorded() public {
        vm.prank(owner);
        anchor.setSigner(signer2, true);
        vm.prank(signer2);
        anchor.anchorEvidence(E1, I1, H1, 1, 1);
        assertEq(anchor.getAnchor(E1).anchoredBy, signer2);
    }

    // ------------------------------------------------------------------ invalid input

    function test_anchor_rejectsZeroValues() public {
        vm.startPrank(signer);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.ZeroValue.selector, "evidenceRef"));
        anchor.anchorEvidence(bytes32(0), I1, H1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.ZeroValue.selector, "incidentRef"));
        anchor.anchorEvidence(E1, bytes32(0), H1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.ZeroValue.selector, "evidenceHash"));
        anchor.anchorEvidence(E1, I1, bytes32(0), 1, 1);
        vm.stopPrank();
        assertEq(anchor.anchorCount(), 0);
    }

    function test_anchor_rejectsZeroVersionOrSequence() public {
        vm.startPrank(signer);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.InvalidVersion.selector, uint32(0)));
        anchor.anchorEvidence(E1, I1, H1, 0, 1);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.InvalidVersion.selector, uint32(0)));
        anchor.anchorEvidence(E1, I1, H1, 1, 0);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ duplicates

    function test_anchor_rejectsDuplicateEvidenceRef() public {
        _anchor(E1, I1, H1, 1, 1);
        vm.prank(signer);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.EvidenceAlreadyAnchored.selector, E1));
        anchor.anchorEvidence(E1, I1, H2, 1, 1); // even with a different hash: an anchor can never be replaced
        assertEq(anchor.getAnchor(E1).evidenceHash, H1);
        assertEq(anchor.anchorCount(), 1);
    }

    function test_anchor_rejectsSameHashUnderAnotherReference() public {
        _anchor(E1, I1, H1, 1, 1);
        vm.prank(signer);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.HashAlreadyAnchored.selector, H1, E1));
        anchor.anchorEvidence(E2, I1, H1, 1, 2);
    }

    function test_anchor_differentSignerCannotOverwrite() public {
        _anchor(E1, I1, H1, 1, 1);
        vm.prank(owner);
        anchor.setSigner(signer2, true);
        vm.prank(signer2);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.EvidenceAlreadyAnchored.selector, E1));
        anchor.anchorEvidence(E1, I1, H2, 1, 1);
    }

    // ------------------------------------------------------------------ retrieval and comparison

    function test_verify_trueOnlyForTheAnchoredHash() public {
        _anchor(E1, I1, H1, 1, 1);
        assertTrue(anchor.verify(E1, H1));
        assertFalse(anchor.verify(E1, H2)); // incorrect hash
        assertFalse(anchor.verify(E2, H1)); // wrong reference
        assertFalse(anchor.verify(E2, H2)); // never anchored
    }

    function test_verify_neverTrueForZero() public view {
        assertFalse(anchor.verify(bytes32(0), bytes32(0)));
        assertFalse(anchor.verify(E1, bytes32(0)));
    }

    function test_getAnchor_unknownReferenceIsAllZero() public view {
        EvidenceAnchor.Anchor memory a = anchor.getAnchor(E1);
        assertEq(a.evidenceHash, bytes32(0));
        assertEq(a.anchoredBy, address(0));
        assertFalse(anchor.isAnchored(E1));
        assertEq(anchor.evidenceRefOfHash(H1), bytes32(0));
    }

    // ------------------------------------------------------------------ several incidents and records

    function test_multipleRecordsAcrossIncidentsAreIndependent() public {
        _anchor(E1, I1, H1, 1, 1);
        vm.roll(1300);
        _anchor(E2, I2, H2, 2, 1);
        assertEq(anchor.getAnchor(E1).incidentRef, I1);
        assertEq(anchor.getAnchor(E2).incidentRef, I2);
        assertEq(anchor.getAnchor(E2).schemaVersion, 2);
        assertEq(anchor.getAnchor(E2).blockNumber, 1300);
        assertEq(anchor.anchorCount(), 2);
        assertTrue(anchor.verify(E1, H1));
        assertTrue(anchor.verify(E2, H2));
        assertFalse(anchor.verify(E1, H2));
    }

    function test_successiveRecordsOfOneIncident() public {
        bytes32 h3 = keccak256("canonical evidence document 3");
        bytes32 e3 = keccak256("corven.evidence.v1:33333333-3333-4333-8333-333333333333");
        _anchor(E1, I1, H1, 1, 1);
        _anchor(E2, I1, H2, 1, 2);
        _anchor(e3, I1, h3, 1, 3);
        assertEq(anchor.getAnchor(E2).sequence, 2);
        assertEq(anchor.getAnchor(e3).sequence, 3);
        assertEq(anchor.getAnchor(e3).incidentRef, I1);
        assertEq(anchor.anchorCount(), 3);
    }

    // ------------------------------------------------------------------ administration

    function test_setSigner_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        anchor.setSigner(stranger, true);
        vm.prank(signer); // a signer is not an administrator
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, signer));
        anchor.setSigner(signer2, true);
    }

    function test_setSigner_emitsAndUpdates() public {
        vm.expectEmit(true, false, false, true, address(anchor));
        emit SignerUpdated(signer2, true);
        vm.prank(owner);
        anchor.setSigner(signer2, true);
        assertTrue(anchor.isSigner(signer2));
        vm.expectEmit(true, false, false, true, address(anchor));
        emit SignerUpdated(signer2, false);
        vm.prank(owner);
        anchor.setSigner(signer2, false);
        assertFalse(anchor.isSigner(signer2));
    }

    function test_setSigner_rejectsZeroAddressAndNoOps() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.InvalidSigner.selector, address(0)));
        anchor.setSigner(address(0), true);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.SignerUnchanged.selector, signer));
        anchor.setSigner(signer, true);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.SignerUnchanged.selector, stranger));
        anchor.setSigner(stranger, false);
        vm.stopPrank();
    }

    function test_ownership_isTwoStep() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        anchor.transferOwnership(newOwner);
        assertEq(anchor.owner(), owner); // not yet
        assertEq(anchor.pendingOwner(), newOwner);
        vm.prank(newOwner);
        anchor.acceptOwnership();
        assertEq(anchor.owner(), newOwner);
        vm.prank(owner); // the previous owner has no power left
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        anchor.setSigner(signer2, true);
    }

    function test_ownership_strangerCannotAcceptOrTransfer() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        anchor.transferOwnership(newOwner);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        anchor.acceptOwnership();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        anchor.transferOwnership(stranger);
    }

    function test_ownership_cannotBeRenounced() public {
        vm.prank(owner);
        vm.expectRevert(EvidenceAnchor.RenounceDisabled.selector);
        anchor.renounceOwnership();
        assertEq(anchor.owner(), owner);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        anchor.renounceOwnership();
    }

    function test_contract_acceptsNoEther() public {
        vm.deal(signer, 1 ether);
        vm.prank(signer);
        (bool ok,) = address(anchor).call{value: 1 wei}("");
        assertFalse(ok);
        vm.prank(signer);
        (bool ok2,) = address(anchor).call{value: 1 wei}(
            abi.encodeWithSelector(EvidenceAnchor.anchorEvidence.selector, E1, I1, H1, uint32(1), uint32(1))
        );
        assertFalse(ok2); // non-payable
        assertEq(address(anchor).balance, 0);
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_anchorThenVerify(bytes32 e, bytes32 i, bytes32 h, uint32 sv, uint32 seq) public {
        vm.assume(e != 0 && i != 0 && h != 0 && sv != 0 && seq != 0);
        _anchor(e, i, h, sv, seq);
        assertTrue(anchor.verify(e, h));
        EvidenceAnchor.Anchor memory a = anchor.getAnchor(e);
        assertEq(a.incidentRef, i);
        assertEq(a.schemaVersion, sv);
        assertEq(a.sequence, seq);
        assertEq(a.evidenceHash, h);
    }

    function testFuzz_strangerNeverAnchors(address who, bytes32 e, bytes32 i, bytes32 h) public {
        vm.assume(who != signer);
        vm.prank(who);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.NotAuthorizedSigner.selector, who));
        anchor.anchorEvidence(e, i, h, 1, 1);
    }

    function testFuzz_anAnchorNeverChanges(bytes32 e, bytes32 h1, bytes32 h2) public {
        vm.assume(e != 0 && h1 != 0 && h2 != 0 && h1 != h2);
        _anchor(e, I1, h1, 1, 1);
        vm.prank(signer);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.EvidenceAlreadyAnchored.selector, e));
        anchor.anchorEvidence(e, I2, h2, 2, 2);
        assertEq(anchor.getAnchor(e).evidenceHash, h1);
        assertEq(anchor.getAnchor(e).incidentRef, I1);
    }

    // The ABI the TypeScript client relies on must not drift unnoticed.
    function test_abi_selectorsAreStable() public pure {
        assertEq(
            EvidenceAnchor.anchorEvidence.selector,
            bytes4(keccak256("anchorEvidence(bytes32,bytes32,bytes32,uint32,uint32)"))
        );
        assertEq(
            EvidenceAnchored.selector, keccak256("EvidenceAnchored(bytes32,bytes32,bytes32,uint32,uint32,address)")
        );
    }
}
