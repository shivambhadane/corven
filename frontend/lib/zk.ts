import { encodePacked, keccak256, toBytes, type Hex } from "viem";

// BN254 scalar field: the zk circuit's numbers live modulo this prime.
const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** A number as the circuit sees it: round(x * 2^scale), halves away from zero, wrapped into the field.
 *  Must match ai-execution/app/zkml/onchain.py (and EZKL) exactly, or the chain will refuse the proof. */
export function quantize(value: number, scale: number): bigint {
  const scaled = value * 2 ** scale;
  const magnitude = BigInt(Math.floor(Math.abs(scaled) + 0.5));
  const signed = scaled >= 0 ? magnitude : -magnitude;
  return ((signed % FIELD_PRIME) + FIELD_PRIME) % FIELD_PRIME;
}

/** What createTaskWithInput stores: the job's model and input, so only a proof about exactly them counts. */
export function inputCommitment(modelCid: string, input: number[], scale: number): Hex {
  const modelKey = keccak256(toBytes(modelCid));
  return keccak256(encodePacked(["bytes32", "uint256[]"], [modelKey, input.map((x) => quantize(x, scale))]));
}
