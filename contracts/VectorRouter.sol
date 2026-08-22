// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  VectorRouter
 * @notice Routes native-USDC sends on Arc through Vector, so a send is a real
 *         on-chain CONTRACT CALL that emits an indexable Vector event — instead
 *         of a bare wallet-to-wallet value transfer that attributes to nothing.
 *
 * @dev WHY THIS EXISTS
 *      On Arc Testnet, USDC is the NATIVE gas asset. A plain send is therefore
 *      `sendTransaction({to, value})` — no contract is touched, no event is
 *      emitted, and nothing in the transaction identifies it as Vector activity.
 *      Routing the same send through `send()` here makes every transfer a call
 *      to Vector's own contract, producing a `VectorSend` log that can be counted
 *      and indexed. The recipient still receives the funds directly.
 *
 * @dev FEES ARE OFF, AND CANNOT BE TURNED INTO A RUG
 *      `feeBps` is initialised to ZERO — this contract forwards 100% of value on
 *      deploy and keeps doing so until an owner explicitly changes it. The owner
 *      CANNOT raise it beyond `MAX_FEE_BPS` (100 bps = 1%), which is a `constant`
 *      baked into the bytecode and therefore not upgradeable or settable. There
 *      is no proxy, no `delegatecall`, and no upgrade path: what is deployed is
 *      final. The worst an owner can ever do is take 1%.
 *
 * @dev THE `amount` ARGUMENT IS A DELIBERATE UNIT GUARD, NOT REDUNDANT
 *      `send()` takes the amount BOTH as `msg.value` and as an explicit argument,
 *      and reverts unless they match exactly. Vector drives this contract from
 *      two very different callers: an external wagmi wallet (which sets
 *      `msg.value` itself, so the two always agree) and Circle's user-controlled
 *      (W3S) wallet, where the native value is handed to Circle's REST API as a
 *      STRING and Circle constructs the transaction. If Circle ever interprets
 *      that string in different units than the calldata was encoded in, the two
 *      will disagree — and this contract will REVERT rather than silently send
 *      dust or an unintended amount. Failing loudly is the point.
 *
 * @dev NO FUNDS CAN EVER BE STRANDED HERE
 *      There is no `receive()` or `fallback()`, so value cannot be sent to this
 *      contract except through `send()`. Inside `send()`, `fee + payout` is
 *      exactly `msg.value` by construction (integer floor on the fee, remainder
 *      to the payout), so the contract's balance is always zero afterward. That
 *      is why no rescue/sweep function is needed — and not having one removes a
 *      privileged withdrawal path entirely.
 *
 * @dev REENTRANCY
 *      `send()` holds no per-user accounting and no balance state, so a reentrant
 *      call from a recipient contract can only start an independent send with its
 *      own `msg.value`. There is nothing to drain, so no guard is used. All state
 *      reads happen before the external calls regardless.
 */
contract VectorRouter {
    /// @notice Hard ceiling on the fee, in basis points. `constant` → in bytecode,
    ///         not storage: no owner, no upgrade, and no future call can raise it.
    uint16 public constant MAX_FEE_BPS = 100; // 1.00%

    /// @dev Basis-point denominator.
    uint256 private constant BPS_DENOMINATOR = 10_000;

    /// @notice May change `feeBps`, `treasury`, and ownership. Nothing else.
    address public owner;

    /// @notice Receives the fee when `feeBps > 0`. Irrelevant while the fee is 0.
    address public treasury;

    /// @notice Current fee in basis points. Starts at 0 (100% forwarded).
    uint16 public feeBps;

    /// @notice Set once fees are permanently renounced; `setFeeBps` then always reverts.
    bool public feesRenounced;

    /**
     * @notice Emitted on every routed send — this is the indexable record of
     *         Vector activity that a plain value transfer cannot produce.
     * @param from      The sender.
     * @param to        The recipient.
     * @param amountIn  Gross amount supplied (== msg.value).
     * @param amountOut Amount actually delivered to `to`.
     * @param fee       Amount routed to `treasury` (0 while `feeBps` is 0).
     */
    event VectorSend(
        address indexed from,
        address indexed to,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );

    event FeeUpdated(uint16 previousFeeBps, uint16 newFeeBps);
    event TreasuryUpdated(address previousTreasury, address newTreasury);
    event OwnershipTransferred(address previousOwner, address newOwner);
    event FeesRenounced();

    error NotOwner();
    error ZeroAddress();
    error ZeroAmount();
    error ValueMismatch(uint256 provided, uint256 declared);
    error FeeAboveCap(uint16 requested, uint16 cap);
    error FeesAlreadyRenounced();
    error TreasuryUnset();
    error PayoutFailed();
    error FeeTransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /**
     * @param initialOwner   Address allowed to set the fee/treasury later. Use an
     *                       address you control; it starts with no fee enabled.
     * @param initialTreasury Fee recipient. MAY be address(0) at deploy time —
     *                       the fee is 0, so it is unused until you set both.
     */
    constructor(address initialOwner, address initialTreasury) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        treasury = initialTreasury;
        // feeBps intentionally left at its zero default: 100% forwarded.
        emit OwnershipTransferred(address(0), initialOwner);
        if (initialTreasury != address(0)) {
            emit TreasuryUpdated(address(0), initialTreasury);
        }
    }

    /**
     * @notice Route a native-USDC send to `to`, emitting `VectorSend`.
     * @param to     Recipient. Receives `amount` in full while `feeBps` is 0.
     * @param amount Must equal `msg.value` exactly — see the unit-guard note above.
     */
    function send(address to, uint256 amount) external payable {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (msg.value != amount) revert ValueMismatch(msg.value, amount);

        uint256 fee;
        uint16 currentFeeBps = feeBps;

        if (currentFeeBps != 0) {
            address feeTreasury = treasury;
            if (feeTreasury == address(0)) revert TreasuryUnset();
            fee = (amount * currentFeeBps) / BPS_DENOMINATOR;
            if (fee != 0) {
                (bool feeOk, ) = payable(feeTreasury).call{value: fee}("");
                if (!feeOk) revert FeeTransferFailed();
            }
        }

        // Exact by construction: payout + fee == msg.value, so no dust accrues.
        uint256 payout = amount - fee;
        (bool ok, ) = payable(to).call{value: payout}("");
        if (!ok) revert PayoutFailed();

        emit VectorSend(msg.sender, to, amount, payout, fee);
    }

    /**
     * @notice What a given amount would deliver at the CURRENT fee. Lets the UI
     *         read the fee from the chain instead of assuming it is zero.
     */
    function quote(uint256 amount)
        external
        view
        returns (uint256 fee, uint256 payout)
    {
        uint16 currentFeeBps = feeBps;
        fee = currentFeeBps == 0
            ? 0
            : (amount * currentFeeBps) / BPS_DENOMINATOR;
        payout = amount - fee;
    }

    /// @notice Raise or lower the fee, never above `MAX_FEE_BPS`, never after renouncing.
    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        if (feesRenounced) revert FeesAlreadyRenounced();
        if (newFeeBps > MAX_FEE_BPS) revert FeeAboveCap(newFeeBps, MAX_FEE_BPS);
        if (newFeeBps != 0 && treasury == address(0)) revert TreasuryUnset();
        emit FeeUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @notice Permanently give up the ability to charge a fee. Forces `feeBps` to
     *         0 and makes `setFeeBps` revert forever. One-way and irreversible —
     *         a credible "this router will always forward 100%" guarantee.
     */
    function renounceFees() external onlyOwner {
        if (feesRenounced) revert FeesAlreadyRenounced();
        feesRenounced = true;
        if (feeBps != 0) {
            emit FeeUpdated(feeBps, 0);
            feeBps = 0;
        }
        emit FeesRenounced();
    }
}
