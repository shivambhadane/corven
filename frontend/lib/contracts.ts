import { erc20Abi, parseAbi } from "viem";

// Only the functions, events and errors the frontend uses. Errors are listed so failed
// transactions show their real reason (e.g. "TaskNotReady") instead of a generic revert.
const sharedErrors = [
  "error Unauthorized()",
  "error InvalidAddress()",
  "error TaskNotFound()",
  "error InvalidStatusTransition()",
  "error DeadlineNotPassed()",
] as const;

export const taskManagerAbi = parseAbi([
  "function createTask(bytes32 descriptionHash, uint256 deadline, uint256 bountyAmount) returns (bytes32 taskId)",
  "function createTaskWithInput(bytes32 descriptionHash, uint256 deadline, uint256 bountyAmount, bytes32 inputCommitment, uint256 inputLength) returns (bytes32 taskId)",
  "error InvalidCommitment()",
  "event TaskCreated(bytes32 indexed taskId, address indexed creator, bytes32 descriptionHash, uint256 deadline, uint256 bountyAmount)",
  "error InvalidDeadline()",
  "error InvalidBountyAmount()",
  ...sharedErrors,
]);

export const escrowAbi = parseAbi([
  "function deposit(bytes32 taskId, uint256 amount)",
  "function claimRefund(bytes32 taskId)",
  "function refundableAmount(bytes32 taskId, address funder) view returns (uint256)",
  "function depositOf(bytes32 taskId, address funder) view returns (uint256)",
  "error InvalidAmount()",
  "error TaskNotFundable()",
  "error InsufficientFunds()",
  "error DeadlinePassed()",
  "error RefundNotAvailable()",
  "error NothingToRefund()",
  ...sharedErrors,
]);

export const settlementAbi = parseAbi([
  "function settle(bytes32 taskId)",
  "error ResultNotSubmitted()",
  "error TaskNotReady()",
  "error InsufficientFunds()",
  "error InvalidAmount()",
  "error DeadlinePassed()",
  ...sharedErrors,
]);

export const tokenAbi = [...erc20Abi, ...parseAbi(["function mint(address to, uint256 amount)"])] as const;
