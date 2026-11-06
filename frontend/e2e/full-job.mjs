// End-to-end check of the whole marketplace, driven through the browser.
//
// Needs the local stack running (scripts/dev-up.sh). Posts three jobs as the local test account
// and follows each one until all the money has gone where it should:
//   1. 300 PBT, zk proof required: every agent bids, the lowest bid wins, the run is proven and the
//      chain's verifier contract checks the proof, the agent gets 81% of its bid, and the poster
//      reclaims the part of the bounty the winner didn't ask for
//   2. 50 PBT, no proof required: Nova (minimum 200 PBT) stays out; same payout and refund rules
//   4. 100 PBT on the model trained with federated learning (federated/), if one is registered:
//      proven off chain, paid and refunded the same way
//   3. 5 PBT: below every agent's minimum, so nobody bids; once the chain's clock passes the
//      deadline the job expires and the poster takes the whole bounty back
//   5. 60 PBT, created on chain but never funded (as when a wallet's deposit is refused): funded
//      from the job's page with "Fund this job", then bid on, paid and refunded like the others
//
//   npm run e2e
//   FRONTEND_URL=http://localhost:3000 RPC_URL=http://127.0.0.1:8545 CHROME_PATH=/usr/bin/google-chrome \
//   SCREENSHOT_DIR=/tmp/shots npm run e2e

import { chromium } from "playwright-core";
import { encodeFunctionData, parseAbi, parseEventLogs, parseUnits } from "viem";

const BASE = process.env.FRONTEND_URL ?? "http://localhost:3000";
const APP = `${BASE}/marketplace`;
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const SHOTS = process.env.SCREENSHOT_DIR;
const FEATURES = [0.62, 1.4, 0.35];
const EXPECTED_RESULT = 0.5 * FEATURES[0] + 1.0 * FEATURES[1] + 2.0 * FEATURES[2] + 0.25; // the demo model
const CENT = 0.011; // amounts on the page are rounded to 2 decimals
const TEST_ACCOUNT = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // Hardhat #3, the site's local test account
const taskManagerAbi = parseAbi([
  "function createTask(bytes32 descriptionHash, uint256 deadline, uint256 bountyAmount) returns (bytes32 taskId)",
  "event TaskCreated(bytes32 indexed taskId, address indexed creator, bytes32 descriptionHash, uint256 deadline, uint256 bountyAmount)",
]);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(err.message));

const check = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok  ${message}`);
};
const near = (a, b) => Math.abs(a - b) <= CENT;
const amountOf = (text) => Number(text.replace(/[^0-9.]/g, ""));
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const rpc = (method, params = []) =>
  fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
const rpcResult = async (method, params) => (await (await rpc(method, params)).json()).result;

async function balance() {
  await page.locator('[data-testid="balance"]', { hasText: "PBT" }).waitFor();
  return amountOf(await page.textContent('[data-testid="balance"]'));
}

async function waitForBalance(expected) {
  await page.waitForFunction(
    ([want, cent]) => Math.abs(Number(document.querySelector('[data-testid="balance"]').textContent.replace(/[^0-9.]/g, "")) - want) <= cent,
    [expected, CENT],
    { timeout: 20_000 },
  );
}

async function postJob(title, bounty, deadlineSeconds = 86_400, prove = true, modelCid = "local-demo") {
  await page.goto(APP);
  // the zk option only renders in the browser, once the chain config has loaded: typing before that
  // could race the page taking over from the server render
  await page.locator("#job-prove").waitFor({ timeout: 15_000 });
  await page.fill("#job-title", title);
  await page.locator(`#job-model option[value="${modelCid}"]`).waitFor({ state: "attached", timeout: 15_000 });
  await page.selectOption("#job-model", modelCid);
  if (prove !== null) await page.setChecked("#job-prove", prove);
  for (const [i, value] of FEATURES.entries()) await page.fill(`#feature-${i + 1}`, String(value));
  await page.fill("#job-bounty", String(bounty));
  await page.selectOption("#job-deadline", String(deadlineSeconds));
  await page.click("#post-job");
  await page.waitForURL(/\/tasks\/0x[0-9a-f]{64}$/, { timeout: 60_000 });
  return page.url().split("/").pop();
}

// A job whose deposit never happened: its description is stored and createTask is sent straight to
// the node (which signs for the test account), then the job's page funds it.
async function postUnfundedThenFund(title, bounty) {
  const config = await (await fetch(`${BASE}/exec/api/chain/config`)).json();
  const form = new FormData();
  const spec = JSON.stringify({ version: 1, title, model_cid: "local-demo", input: FEATURES });
  form.append("file", new Blob([spec], { type: "application/json" }), "task.json");
  const stored = await (await fetch(`${BASE}/storage/upload`, { method: "POST", body: form })).json();
  const deadline = BigInt((await rpcResult("eth_getBlockByNumber", ["latest", false])).timestamp) + 86_400n;
  const data = encodeFunctionData({
    abi: taskManagerAbi,
    functionName: "createTask",
    args: [`0x${stored.content_hash}`, deadline, parseUnits(String(bounty), 18)],
  });
  const hash = await rpcResult("eth_sendTransaction", [{ from: TEST_ACCOUNT, to: config.contracts.TaskManager, data }]);
  const receipt = await rpcResult("eth_getTransactionReceipt", [hash]);
  const [created] = parseEventLogs({ abi: taskManagerAbi, logs: receipt.logs, eventName: "TaskCreated" });
  const taskId = created.args.taskId;

  await page.goto(`${BASE}/tasks/${taskId}`);
  await waitForStage("Awaiting funding", 30_000);
  const fund = page.locator("#fund-job");
  await fund.waitFor({ timeout: 15_000 });
  check(near(amountOf(await fund.textContent()), bounty), `the job page offers to lock the missing ${bounty} PBT`);
  await shot("06-job-unfunded");
  await fund.click();
  await page.locator('[data-testid="funding"]').waitFor({ state: "detached", timeout: 30_000 });
  return taskId;
}

async function waitForStage(label, timeout = 120_000) {
  await page.locator('[data-testid="stage"]', { hasText: label }).waitFor({ timeout });
}

async function bids() {
  return page.locator('[data-testid="bids"] tbody tr').evaluateAll((rows) =>
    rows.map((row) => ({
      agent: row.cells[0].textContent.replace(" — winner", ""),
      winner: row.classList.contains("winner"),
      amount: Number(row.cells[2].textContent.replace(/,/g, "")),
    })),
  );
}

async function payout() {
  return (await page.locator('[data-testid="payout"] strong').allTextContents()).map(amountOf);
}

async function claimRefund() {
  const button = page.locator("#claim-refund");
  await button.waitFor({ timeout: 20_000 });
  const offered = amountOf(await button.textContent());
  await button.click();
  await page.locator("#claim-refund").waitFor({ state: "detached", timeout: 30_000 });
  return offered;
}

// One settled job: checks the bids, the result, the split of the winning price and the refund.
async function settledJob(
  name, bounty, expectedBidders, excluded, prove, modelCid = "local-demo", tolerance = 1e-3,
  post = (title) => postJob(title, bounty, 86_400, prove, modelCid),
) {
  const start = await balance();
  const taskId = await post(`E2E ${name} ${Date.now() % 100000}`);
  check(/^0x[0-9a-f]{64}$/.test(taskId), `${name}: posted and funded on chain (${taskId.slice(0, 12)}…)`);
  await waitForStage("Settled");

  const all = await bids();
  check(all.length === expectedBidders, `${name}: ${all.length} agents bid (${all.map((b) => b.agent).join(", ")})`);
  if (excluded) check(!all.some((b) => b.agent === excluded), `${name}: ${excluded} stayed out`);
  const winner = all.find((b) => b.winner);
  const lowest = Math.min(...all.map((b) => b.amount));
  check(winner && winner.amount === lowest, `${name}: lowest bid won — ${winner?.agent} at ${lowest} PBT`);

  const result = (await page.textContent('[data-testid="result"]')).match(/-?\d+(\.\d+)?/g).map(Number);
  check(Math.abs(result[0] - EXPECTED_RESULT) < tolerance, `${name}: model output ${result[0]} ≈ ${EXPECTED_RESULT}`);
  check((await page.locator(".pill", { hasText: "Verified" }).count()) > 0, `${name}: receipt verified before payment`);
  check((await page.textContent('[data-testid="zk-proof"]')).startsWith("Verified"), `${name}: zk proof of the run verified`);
  const provenOnChain = (await page.locator('[data-testid="proven-on-chain"]').count()) > 0;
  check(provenOnChain === Boolean(prove), `${name}: ${prove ? "the chain's verifier contract checked the proof" : "no on-chain proof check"}`);

  const [agent, stakers, treasury] = await payout();
  check(near(agent, winner.amount * 0.81), `${name}: agent paid 81% of its bid (${agent} PBT)`);
  check(near(agent + stakers + treasury, winner.amount), `${name}: the split adds up to the winning price`);

  const refund = await claimRefund();
  check(near(refund, bounty - winner.amount), `${name}: poster reclaims the unused ${refund} PBT`);
  await waitForBalance(start - winner.amount);
  check(true, `${name}: poster paid exactly the winning price overall`);
  return winner.amount;
}

try {
  console.log("landing page");
  await page.goto(BASE);
  check((await page.textContent("h1")).includes("Pay AI agents only for verified work"), "landing page shows the hero");
  await shot("00-landing");
  await page.locator("header").getByRole("link", { name: "Launch app" }).click();
  await page.waitForURL(APP);
  check(true, "its Launch app button opens the marketplace");

  console.log("connect");
  await page.goto(APP);
  await page.getByRole("button", { name: "Use local test account" }).click();
  if ((await balance()) < 400) {
    const before = await balance();
    await page.getByRole("button", { name: "Get test PBT" }).click();
    await waitForBalance(before + 1000);
  }
  const before = await balance();
  check(before >= 400, `test account holds ${before} PBT`);
  await shot("01-home-connected");

  console.log("job 1: 300 PBT, open to every agent");
  const price1 = await settledJob("job 1", 300, 4, undefined, true);
  await shot("02-job-settled");

  console.log("job 2: 50 PBT, below Nova's minimum");
  const price2 = await settledJob("job 2", 50, 3, "Nova", false);

  const models = await (await fetch(`${BASE}/exec/api/models`)).json();
  const federated = models.find((m) => m.trained_by.startsWith("federated-learning"));
  let price4 = 0;
  if (federated) {
    console.log(`job 4: 100 PBT on ${federated.model_id} (trained with federated learning)`);
    // the learned weights are close to, not exactly, the demo model's
    price4 = await settledJob("job 4", 100, 3, "Nova", null, federated.cid, 0.02);
  }

  console.log("job 5: 60 PBT, posted without its deposit, funded from the job page");
  const price5 = await settledJob("job 5", 60, 3, "Nova", false, "local-demo", 1e-3, (title) => postUnfundedThenFund(title, 60));

  console.log("job 3: 5 PBT, nobody bids, deadline passes");
  const beforeExpiry = await balance();
  await postJob(`E2E unwanted job ${Date.now() % 100000}`, 5, 3600);
  await waitForBalance(beforeExpiry - 5);
  await page.waitForTimeout(8_000); // longer than the auction window: give agents every chance to bid
  check((await page.locator('[data-testid="bids"]').count()) === 0, "job 3: no agent bid on a 5 PBT job");
  await rpc("evm_increaseTime", [2 * 3600]);
  await rpc("evm_mine");
  await waitForStage("Expired", 30_000);
  check(true, "job 3: expired once the chain's clock passed the deadline");
  await shot("03-job-expired");
  const back = await claimRefund();
  check(near(back, 5), `job 3: poster took the whole ${back} PBT back`);
  await waitForBalance(beforeExpiry);

  await page.goto(APP);
  await page.locator("tbody tr").first().waitFor();
  const after = await balance();
  check(near(before - after, price1 + price2 + price4 + price5), `overall the poster paid only the winning prices (${before} → ${after})`);
  await shot("04-home-after");

  await page.setViewportSize({ width: 390, height: 844 });
  await shot("05-home-mobile");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, "no horizontal scroll at phone width");

  check(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors.join("; ")}` : ""}`);
  console.log("PASS");
} catch (err) {
  await shot("failure");
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
