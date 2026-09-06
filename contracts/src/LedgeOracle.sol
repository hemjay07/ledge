// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LedgeOracle
/// @notice Holds the current LEDGE reading of the Pons launch factory on Robinhood Chain,
///         republished hourly by the LEDGE crawler. Definitions: ledge.tools/method
/// @dev    What the numbers are, plainly:
///
///         `launches24h` is a count of `TokenLaunched` events emitted by the Pons factory whose
///         block timestamp fell in the half-open window [crawledAt - 86400, crawledAt).
///         `graduations24h` is a count of `PoolGraduated` events for tokens launched inside that
///         same window, counted whenever the graduation happened, including after `crawledAt`.
///         `rate24hBps` is graduations24h/launches24h in basis points (10000 = 100.00%).
///         `excludingFastBps` is the same ratio with graduations that completed in under
///         FAST_CUTOFF seconds of their launch removed from the numerator only; the denominator
///         is unchanged.
///
///         Both counts are stored so no reader ever has a rate without its denominator, and so
///         either rate can be recomputed from this slot alone.
///
///         Every figure here is a count of launches and graduations that already happened, over
///         a stated past window. Nothing here is a forecast. Mirroring ledge.tools/method: it is
///         not a claim about any individual token.
///
///         Below MIN_N launches a window is too small to publish a ratio from. MIN_N is public
///         here so a reader can check that for itself against `launches24h`; the publisher
///         refuses to send such a reading in the first place.
///
///         Storage: one packed slot for the reading (4+4+4+4+8+8 = 32 bytes), one for
///         `publishedAt`. No proxy, no upgrade path, no pause, no way to alter a stored reading
///         except by publishing a newer one. `crawledAt` must strictly increase, so a replayed
///         or reordered publish reverts and a stalled publisher is visible on-chain as a
///         `crawledAt` that has stopped advancing.
contract LedgeOracle {
    /// @notice One reading of the window ending at `crawledAt`.
    /// @param rate24hBps graduations24h / launches24h, in basis points (10000 = 100.00%)
    /// @param excludingFastBps the same ratio excluding graduations under FAST_CUTOFF seconds
    /// @param launches24h the denominator: launches in the window
    /// @param graduations24h the numerator: graduations of those launches
    /// @param crawledAt unix seconds, the window's exclusive upper bound `until`
    /// @param definitionsVersion ASCII date of the definitions in force, e.g. "20260906"
    struct Reading {
        uint32 rate24hBps;
        uint32 excludingFastBps;
        uint32 launches24h;
        uint32 graduations24h;
        uint64 crawledAt;
        bytes8 definitionsVersion;
    }

    /// @notice Smallest denominator LEDGE publishes a ratio from.
    uint32 public constant MIN_N = 30;

    /// @notice A graduation completing in fewer than this many seconds after its launch is
    ///         excluded from `excludingFastBps`. A descriptive threshold, not a verdict.
    uint32 public constant FAST_CUTOFF = 300;

    /// @notice Rotates the writer and hands over ownership. Holds no other power.
    address public owner;

    /// @notice Nominated owner, effective only once it calls `acceptOwnership`.
    address public pendingOwner;

    /// @notice The only address that may call `publish`.
    address public writer;

    /// @notice Block timestamp of the last accepted publish. Distinct from the reading's
    ///         `crawledAt`, which is when the measured window ended.
    uint64 public publishedAt;

    Reading private _latest;

    event Published(
        uint32 rate24hBps,
        uint32 excludingFastBps,
        uint32 launches24h,
        uint32 graduations24h,
        uint64 crawledAt,
        bytes8 definitionsVersion
    );
    event WriterRotated(address indexed previous, address indexed next);
    event OwnershipTransferStarted(address indexed owner, address indexed pending);
    event OwnerTransferred(address indexed previous, address indexed next);

    error NotWriter();
    error NotOwner();
    error NotPendingOwner();
    /// @dev crawledAt did not advance past the stored reading's crawledAt.
    error StaleReading();
    /// @dev graduations24h > launches24h, or a bps figure above 10000.
    error ImpossibleReading();

    /// @param writer_ the publishing key; may be rotated later without redeploying
    constructor(address writer_) {
        owner = msg.sender;
        writer = writer_;
        emit OwnerTransferred(address(0), msg.sender);
        emit WriterRotated(address(0), writer_);
    }

    /// @notice Store the reading for the window ending at `r.crawledAt`.
    /// @dev Reverts unless `r.crawledAt` is strictly greater than the stored reading's, so a
    ///      resent transaction cannot overwrite a newer reading with an older one.
    function publish(Reading calldata r) external {
        if (msg.sender != writer) revert NotWriter();
        if (r.crawledAt <= _latest.crawledAt) revert StaleReading();
        if (r.graduations24h > r.launches24h) revert ImpossibleReading();
        if (r.rate24hBps > 10000 || r.excludingFastBps > 10000) revert ImpossibleReading();
        _latest = r;
        publishedAt = uint64(block.timestamp);
        emit Published(
            r.rate24hBps, r.excludingFastBps, r.launches24h, r.graduations24h, r.crawledAt, r.definitionsVersion
        );
    }

    /// @notice The current reading. All zeroes before the first publish; check `crawledAt != 0`.
    function latest() external view returns (Reading memory) {
        return _latest;
    }

    /// @notice Point `publish` at a new key. Takes effect immediately; the previous key loses
    ///         all access in the same transaction.
    function setWriter(address next) external {
        if (msg.sender != owner) revert NotOwner();
        emit WriterRotated(writer, next);
        writer = next;
    }

    /// @notice Nominate a new owner. Two steps, so a mistyped address cannot strand the contract.
    function transferOwnership(address next) external {
        if (msg.sender != owner) revert NotOwner();
        pendingOwner = next;
        emit OwnershipTransferStarted(owner, next);
    }

    /// @notice Complete a transfer started by the current owner.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnerTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}
