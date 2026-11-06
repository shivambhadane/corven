// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title EvidenceAnchor
 * @notice Public, append-only commitments to CORVEN incident evidence.
 *
 * What it stores is a SHA-256 commitment and public references, nothing else: no descriptions,
 * comments, payloads, credentials or personal data. The evidence document itself stays in CORVEN
 * (and, when anchored there, Arkiv). Anyone holding a document can recompute its hash and check
 * it against this contract; a matching hash proves the document has not changed since it was
 * anchored. It does NOT prove the recorded events were genuine.
 *
 * References are commitments, not raw ids:
 *   evidenceRef = keccak256("corven.evidence.v1:" + evidenceUuid)
 *   incidentRef = keccak256("corven.incident.v1:" + incidentUuid)
 * so a reviewer who knows a uuid can recompute the reference, and the chain reveals nothing else.
 *
 * Access: only addresses the owner has authorised as signers can anchor. The owner (a two-step
 * transfer, never renounceable) manages the signer set and cannot anchor unless also authorised.
 * Anchors cannot be changed or removed by anyone, including the owner. The contract is not upgradeable.
 */
contract EvidenceAnchor is Ownable2Step {
    /// @param incidentRef  commitment to the incident uuid
    /// @param evidenceHash SHA-256 of the canonical evidence document, exactly as produced by CORVEN
    /// @param schemaVersion version of the evidence document schema (>= 1)
    /// @param sequence     position of the record in the incident's evidence chain (>= 1)
    /// @param anchoredBy   the authorised signer that anchored it
    /// @param blockNumber  block in which it was anchored (lets a verifier fetch the log directly)
    /// @param timestamp    block timestamp
    struct Anchor {
        bytes32 incidentRef;
        bytes32 evidenceHash;
        uint32 schemaVersion;
        uint32 sequence;
        address anchoredBy;
        uint64 blockNumber;
        uint64 timestamp;
    }

    mapping(bytes32 evidenceRef => Anchor) private _anchors;
    mapping(bytes32 evidenceHash => bytes32 evidenceRef) private _refByHash;
    mapping(address signer => bool) private _isSigner;
    uint256 public anchorCount;

    event EvidenceAnchored(
        bytes32 indexed evidenceRef,
        bytes32 indexed incidentRef,
        bytes32 indexed evidenceHash,
        uint32 schemaVersion,
        uint32 sequence,
        address anchoredBy
    );
    event SignerUpdated(address indexed signer, bool authorized);

    error NotAuthorizedSigner(address caller);
    error ZeroValue(string field);
    error InvalidVersion(uint32 value);
    error EvidenceAlreadyAnchored(bytes32 evidenceRef);
    error HashAlreadyAnchored(bytes32 evidenceHash, bytes32 existingEvidenceRef);
    error InvalidSigner(address signer);
    error SignerUnchanged(address signer);
    error RenounceDisabled();

    modifier onlySigner() {
        if (!_isSigner[msg.sender]) revert NotAuthorizedSigner(msg.sender);
        _;
    }

    /// @param initialOwner administrator of the signer set (use a dedicated key or multisig)
    /// @param initialSigner first authorised signer, or address(0) to start with none
    constructor(address initialOwner, address initialSigner) Ownable(initialOwner) {
        if (initialSigner != address(0)) _setSigner(initialSigner, true);
    }

    // ------------------------------------------------------------------ anchoring

    /// @notice Anchors one evidence record. Reverts on any zero value, a zero version or sequence,
    ///         a duplicate evidence reference, or a hash that is already anchored.
    function anchorEvidence(
        bytes32 evidenceRef,
        bytes32 incidentRef,
        bytes32 evidenceHash,
        uint32 schemaVersion,
        uint32 sequence
    ) external onlySigner {
        if (evidenceRef == bytes32(0)) revert ZeroValue("evidenceRef");
        if (incidentRef == bytes32(0)) revert ZeroValue("incidentRef");
        if (evidenceHash == bytes32(0)) revert ZeroValue("evidenceHash");
        if (schemaVersion == 0) revert InvalidVersion(schemaVersion);
        if (sequence == 0) revert InvalidVersion(sequence);
        if (_anchors[evidenceRef].evidenceHash != bytes32(0)) revert EvidenceAlreadyAnchored(evidenceRef);
        bytes32 existing = _refByHash[evidenceHash];
        if (existing != bytes32(0)) revert HashAlreadyAnchored(evidenceHash, existing);

        _anchors[evidenceRef] = Anchor({
            incidentRef: incidentRef,
            evidenceHash: evidenceHash,
            schemaVersion: schemaVersion,
            sequence: sequence,
            anchoredBy: msg.sender,
            // forge-lint: disable-next-line(unsafe-typecast)
            blockNumber: uint64(block.number), // a block number and a unix timestamp fit in 64 bits for billions of years
            // forge-lint: disable-next-line(unsafe-typecast)
            timestamp: uint64(block.timestamp)
        });
        _refByHash[evidenceHash] = evidenceRef;
        unchecked {
            ++anchorCount;
        }
        emit EvidenceAnchored(evidenceRef, incidentRef, evidenceHash, schemaVersion, sequence, msg.sender);
    }

    // ------------------------------------------------------------------ verification (views)

    /// @notice The stored anchor, or an all-zero struct if none exists.
    function getAnchor(bytes32 evidenceRef) external view returns (Anchor memory) {
        return _anchors[evidenceRef];
    }

    function isAnchored(bytes32 evidenceRef) external view returns (bool) {
        return _anchors[evidenceRef].evidenceHash != bytes32(0);
    }

    /// @notice True iff `evidenceRef` is anchored AND its stored hash equals `evidenceHash`.
    function verify(bytes32 evidenceRef, bytes32 evidenceHash) external view returns (bool) {
        bytes32 stored = _anchors[evidenceRef].evidenceHash;
        return stored != bytes32(0) && stored == evidenceHash;
    }

    /// @notice The evidence reference a hash was anchored under, or zero.
    function evidenceRefOfHash(bytes32 evidenceHash) external view returns (bytes32) {
        return _refByHash[evidenceHash];
    }

    function isSigner(address account) external view returns (bool) {
        return _isSigner[account];
    }

    // ------------------------------------------------------------------ administration

    /// @notice Authorises or removes a signer. Removal takes effect immediately; anchors already made stay.
    function setSigner(address signer, bool authorized) external onlyOwner {
        _setSigner(signer, authorized);
    }

    /// @dev Renouncing would leave the signer set unmanageable forever.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function _setSigner(address signer, bool authorized) private {
        if (signer == address(0)) revert InvalidSigner(signer);
        if (_isSigner[signer] == authorized) revert SignerUnchanged(signer);
        // forge-lint: disable-next-line(missing-events-access-control)
        _isSigner[signer] = authorized; // SignerUpdated is emitted on the next line
        emit SignerUpdated(signer, authorized);
    }
}
