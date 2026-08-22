# Deploying VectorRouter to Arc Testnet

`contracts/VectorRouter.sol` makes a Vector send a real on-chain **contract call**
that emits an indexable `VectorSend` event, instead of an anonymous native value
transfer that attributes to nothing. The fee is deployed at **zero**, so the
recipient still receives 100%.

Until the address is wired into `NEXT_PUBLIC_VECTOR_ROUTER_ARC`, both Send paths
keep using the plain-transfer behaviour that is already live — nothing breaks
while you work through this, and there is no half-shipped state.

> **Not compiled locally.** The sandbox this was written in has no `solc` and no
> network access to fetch one, so the contract has been reviewed by hand but not
> compiled. Remix compiles in the browser, so step 2 is where you will find any
> compiler complaint — before anything is deployed and before any funds move.

## Arc Testnet parameters

All verified from the repo's own dependencies, not guessed —
`node_modules/@circle-fin/app-kit/chains.d.mts` (`ArcTestnet`, line 112) and
`viem/chains`' `arcTestnet`:

| Field | Value |
| --- | --- |
| Chain ID | `5042002` (hex `0x4CEF52`) |
| RPC | `https://rpc.testnet.arc.network/` |
| Native currency | `USDC`, symbol `USDC`, **18 decimals** |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` → Network: *Arc Testnet* |

Gas on Arc is paid in USDC, so the deploying wallet needs a small USDC balance
from the faucet. There is no separate ETH to acquire.

## 1. Add Arc Testnet to MetaMask

Settings → Networks → Add network manually, using the table above. Set the
currency symbol to `USDC` and decimals to `18`. Then fund the account from
`https://faucet.circle.com`.

## 2. Compile in Remix

1. Open <https://remix.ethereum.org>.
2. Create `VectorRouter.sol` and paste in the contents of
   `contracts/VectorRouter.sol` from this repo.
3. Solidity Compiler tab: choose **0.8.24** (anything `^0.8.20` works).
4. Open **Advanced Configurations** and set **EVM Version** to `paris`.
   This matters: the default (`shanghai`/`cancun`) emits the `PUSH0` opcode, and
   if Arc's EVM predates it the deployment fails for a reason that is hard to
   diagnose. `paris` bytecode runs on every EVM including newer ones, so it is
   strictly the safer choice.
5. Turn the **optimizer** on at 200 runs.
6. Compile. Expect no errors and no warnings.

## 3. Deploy

1. Deploy & Run tab → Environment: **Injected Provider – MetaMask**.
2. Confirm the network reads chain `5042002`. If it does not, switch MetaMask
   first — deploying to the wrong chain wastes the deploy, nothing worse.
3. Constructor arguments:
   - `initialOwner` — an address **you control**. This is the only address that
     can ever change the fee, and it cannot raise it above `MAX_FEE_BPS` (100 bps
     = 1%), which is a `constant` in the bytecode with no upgrade path.
   - `initialTreasury` — set this to your own address too. It is unused while the
     fee is 0, but setting it now means enabling a fee later is a single
     `setFeeBps` call rather than two transactions.
4. Deploy, then copy the deployed address.

## 4. Verify on Arcscan

Open `https://testnet.arcscan.app/address/<your-router-address>` and verify the
source. Use the **exact same** compiler version, EVM version (`paris`), and
optimizer setting as step 2, or verification will not match. Verifying is worth
the five minutes: it lets anyone confirm the fee really is zero and that there is
no hidden withdrawal path, which is the whole point of the design.

## 5. Wire it into the app

Add the environment variable in **Vercel → Project → Settings → Environment
Variables**, for Production *and* Preview:

```
NEXT_PUBLIC_VECTOR_ROUTER_ARC=0xYourRouterAddress
```

For local development, add the same line to `.env.local`.

**`NEXT_PUBLIC_*` variables are baked in at build time, so you must trigger a new
deploy** — saving the variable alone changes nothing on the live site.

## 6. Test with a tiny amount first

Send **0.01 USDC**, not a round number, and do it once per wallet path:

1. **External wallet (MetaMask on Arc).** On Arcscan the transaction should show
   *To: your router* with a `VectorSend` log, rather than a plain transfer, and
   the recipient's balance should increase by the full 0.01.
2. **Google login (Circle W3S wallet).** Same expected result. This path is the
   one worth watching closely, because Circle's REST API receives the native
   value as a decimal *string* and constructs the transaction itself.

If the Google-path transaction **reverts with `ValueMismatch`**, that is the
contract's unit guard working exactly as intended: Circle interpreted the value
string in different units than the calldata was encoded in, and the router
refused rather than moving a wrong amount. Nothing is lost but gas. The fix is in
`app/components/GoogleSendPanel.tsx` — change the `amount` field sent to
`createContractExecutionChallenge` from the human-readable string to minor units,
i.e. `parseUnits(amountTrimmed, ARC_NATIVE_DECIMALS).toString()`, and redeploy.
The revert tells you which convention Circle actually uses, which is information
that cannot be obtained from the documentation.

## What the owner can and cannot do

Worth being able to state precisely, since Vector positions itself as
non-custodial:

- **Can**: set `feeBps` anywhere from 0 to 100 (0%–1%), change the treasury,
  transfer ownership, and permanently renounce fees via `renounceFees()`.
- **Cannot**: exceed 1%, upgrade or replace the logic (no proxy, no
  `delegatecall`), pause sends, touch a user's balance, or withdraw from the
  contract — there is no `receive()`/`fallback()` and `fee + payout` always
  equals `msg.value` exactly, so the contract's balance is zero after every call
  and no sweep function exists to need auditing.

If you want the strongest possible claim, call `renounceFees()` after deploying:
the fee is then locked at zero forever and `setFeeBps` reverts permanently. You
would give up the option of monetising sends later, so only do this if you are
sure — revenue is better sought from swap/bridge/earn spreads anyway, where you
are adding routing value rather than taxing a peer-to-peer payment.
