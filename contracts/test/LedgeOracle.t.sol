// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LedgeOracle} from "../src/LedgeOracle.sol";

contract LedgeOracleTest is Test {
    LedgeOracle internal oracle;

    address internal ownerAddr = address(0xA11CE);
    address internal writerAddr = address(0xB0B);
    address internal strangerAddr = address(0xDEAD);

    // casting to 'bytes8' is safe because the literal is exactly 8 ASCII bytes
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes8 internal constant DEFS = bytes8("20260906");

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

    function setUp() public {
        vm.prank(ownerAddr);
        oracle = new LedgeOracle(writerAddr);
    }

    function _reading(uint64 crawledAt) internal pure returns (LedgeOracle.Reading memory) {
        return LedgeOracle.Reading({
            rate24hBps: 181,
            excludingFastBps: 52,
            launches24h: 5900,
            graduations24h: 107,
            crawledAt: crawledAt,
            definitionsVersion: DEFS
        });
    }

    // ---------------------------------------------------------------- deploy

    function test_constructor_setsOwnerAndWriter() public view {
        assertEq(oracle.owner(), ownerAddr);
        assertEq(oracle.writer(), writerAddr);
        assertEq(oracle.pendingOwner(), address(0));
        assertEq(oracle.publishedAt(), 0);
        assertEq(oracle.MIN_N(), 30);
        assertEq(oracle.FAST_CUTOFF(), 300);
    }

    function test_latest_isEmptyBeforeFirstPublish() public view {
        LedgeOracle.Reading memory r = oracle.latest();
        assertEq(r.crawledAt, 0);
        assertEq(r.launches24h, 0);
    }

    // --------------------------------------------------------------- publish

    function test_publish_storesReadingAndEmits() public {
        LedgeOracle.Reading memory r = _reading(1788717636);
        vm.warp(1788717700);

        vm.expectEmit(false, false, false, true, address(oracle));
        emit Published(181, 52, 5900, 107, 1788717636, DEFS);

        vm.prank(writerAddr);
        oracle.publish(r);

        LedgeOracle.Reading memory stored = oracle.latest();
        assertEq(stored.rate24hBps, 181);
        assertEq(stored.excludingFastBps, 52);
        assertEq(stored.launches24h, 5900);
        assertEq(stored.graduations24h, 107);
        assertEq(stored.crawledAt, 1788717636);
        assertEq(stored.definitionsVersion, DEFS);
        assertEq(oracle.publishedAt(), 1788717700);
    }

    function test_publish_denominatorSurvivesTheRoundTrip() public {
        // CONSTRAINTS section 3: never a rate without its denominator. The stored ratio must be
        // recoverable from the stored counts alone.
        vm.prank(writerAddr);
        oracle.publish(_reading(1788717636));
        LedgeOracle.Reading memory stored = oracle.latest();
        assertEq((uint256(stored.graduations24h) * 10000) / stored.launches24h, stored.rate24hBps);
    }

    function test_publish_secondReadingReplacesTheFirst() public {
        vm.startPrank(writerAddr);
        oracle.publish(_reading(1788717636));
        LedgeOracle.Reading memory next = _reading(1788721236);
        next.launches24h = 6000;
        next.graduations24h = 120;
        next.rate24hBps = 200;
        oracle.publish(next);
        vm.stopPrank();

        LedgeOracle.Reading memory stored = oracle.latest();
        assertEq(stored.crawledAt, 1788721236);
        assertEq(stored.launches24h, 6000);
        assertEq(stored.rate24hBps, 200);
    }

    function test_publish_revertsForStaleReading() public {
        vm.startPrank(writerAddr);
        oracle.publish(_reading(1788717636));

        vm.expectRevert(LedgeOracle.StaleReading.selector);
        oracle.publish(_reading(1788717635));
        vm.stopPrank();
    }

    function test_publish_revertsWhenCrawledAtIsUnchanged() public {
        // A retried transaction carries the same crawledAt: replay must be impossible.
        vm.startPrank(writerAddr);
        oracle.publish(_reading(1788717636));

        vm.expectRevert(LedgeOracle.StaleReading.selector);
        oracle.publish(_reading(1788717636));
        vm.stopPrank();
    }

    function test_publish_revertsForZeroCrawledAtOnAnEmptyOracle() public {
        vm.prank(writerAddr);
        vm.expectRevert(LedgeOracle.StaleReading.selector);
        oracle.publish(_reading(0));
    }

    function test_publish_revertsForUnauthorisedWriter() public {
        vm.prank(strangerAddr);
        vm.expectRevert(LedgeOracle.NotWriter.selector);
        oracle.publish(_reading(1788717636));
    }

    function test_publish_revertsForOwnerWhoIsNotTheWriter() public {
        vm.prank(ownerAddr);
        vm.expectRevert(LedgeOracle.NotWriter.selector);
        oracle.publish(_reading(1788717636));
    }

    function test_publish_revertsWhenGraduationsExceedLaunches() public {
        LedgeOracle.Reading memory r = _reading(1788717636);
        r.launches24h = 100;
        r.graduations24h = 101;
        vm.prank(writerAddr);
        vm.expectRevert(LedgeOracle.ImpossibleReading.selector);
        oracle.publish(r);
    }

    function test_publish_revertsWhenRateExceedsTenThousandBps() public {
        LedgeOracle.Reading memory r = _reading(1788717636);
        r.rate24hBps = 10001;
        vm.prank(writerAddr);
        vm.expectRevert(LedgeOracle.ImpossibleReading.selector);
        oracle.publish(r);
    }

    function test_publish_revertsWhenExcludingFastExceedsTenThousandBps() public {
        LedgeOracle.Reading memory r = _reading(1788717636);
        r.excludingFastBps = 10001;
        vm.prank(writerAddr);
        vm.expectRevert(LedgeOracle.ImpossibleReading.selector);
        oracle.publish(r);
    }

    // ---------------------------------------------------------------- packing

    function test_packing_lowerBoundaryValues() public {
        LedgeOracle.Reading memory r = LedgeOracle.Reading({
            rate24hBps: 0,
            excludingFastBps: 0,
            launches24h: 0,
            graduations24h: 0,
            crawledAt: 1,
            definitionsVersion: bytes8(0)
        });
        vm.prank(writerAddr);
        oracle.publish(r);

        LedgeOracle.Reading memory stored = oracle.latest();
        assertEq(stored.rate24hBps, 0);
        assertEq(stored.excludingFastBps, 0);
        assertEq(stored.launches24h, 0);
        assertEq(stored.graduations24h, 0);
        assertEq(stored.crawledAt, 1);
        assertEq(stored.definitionsVersion, bytes8(0));
    }

    function test_packing_upperBoundaryValues() public {
        LedgeOracle.Reading memory r = LedgeOracle.Reading({
            rate24hBps: 10000,
            excludingFastBps: 10000,
            launches24h: type(uint32).max,
            graduations24h: type(uint32).max,
            crawledAt: type(uint64).max,
            definitionsVersion: bytes8(0xFFFFFFFFFFFFFFFF)
        });
        vm.prank(writerAddr);
        oracle.publish(r);

        LedgeOracle.Reading memory stored = oracle.latest();
        assertEq(stored.rate24hBps, 10000);
        assertEq(stored.excludingFastBps, 10000);
        assertEq(stored.launches24h, type(uint32).max);
        assertEq(stored.graduations24h, type(uint32).max);
        assertEq(stored.crawledAt, type(uint64).max);
        assertEq(stored.definitionsVersion, bytes8(0xFFFFFFFFFFFFFFFF));
    }

    function testFuzz_packing_roundTrip(
        uint32 rateBps,
        uint32 fastBps,
        uint32 launches,
        uint32 graduations,
        uint64 crawledAt,
        bytes8 defs
    ) public {
        rateBps = uint32(bound(rateBps, 0, 10000));
        fastBps = uint32(bound(fastBps, 0, 10000));
        graduations = uint32(bound(graduations, 0, launches));
        crawledAt = uint64(bound(crawledAt, 1, type(uint64).max));

        LedgeOracle.Reading memory r = LedgeOracle.Reading({
            rate24hBps: rateBps,
            excludingFastBps: fastBps,
            launches24h: launches,
            graduations24h: graduations,
            crawledAt: crawledAt,
            definitionsVersion: defs
        });
        vm.prank(writerAddr);
        oracle.publish(r);

        LedgeOracle.Reading memory stored = oracle.latest();
        assertEq(stored.rate24hBps, rateBps);
        assertEq(stored.excludingFastBps, fastBps);
        assertEq(stored.launches24h, launches);
        assertEq(stored.graduations24h, graduations);
        assertEq(stored.crawledAt, crawledAt);
        assertEq(stored.definitionsVersion, defs);
    }

    function test_packing_readingOccupiesOneSlot() public {
        // Reading is 4+4+4+4+8+8 = 32 bytes. The whole reading must live in a single slot, so a
        // publish is one SSTORE. `_latest` is the fourth declared storage variable: slots 0..2
        // hold owner, pendingOwner and (writer, publishedAt) packed.
        vm.prank(writerAddr);
        oracle.publish(_reading(1788717636));
        bytes32 slot = vm.load(address(oracle), bytes32(uint256(3)));
        assertTrue(slot != bytes32(0));
        assertEq(vm.load(address(oracle), bytes32(uint256(4))), bytes32(0));
    }

    // ------------------------------------------------------------ writer role

    function test_setWriter_rotatesAndEmits() public {
        address next = address(0xC0FFEE);

        vm.expectEmit(true, true, false, false, address(oracle));
        emit WriterRotated(writerAddr, next);

        vm.prank(ownerAddr);
        oracle.setWriter(next);
        assertEq(oracle.writer(), next);
    }

    function test_setWriter_oldWriterLosesAccessAndNewWriterGainsIt() public {
        address next = address(0xC0FFEE);
        vm.prank(ownerAddr);
        oracle.setWriter(next);

        vm.prank(writerAddr);
        vm.expectRevert(LedgeOracle.NotWriter.selector);
        oracle.publish(_reading(1788717636));

        vm.prank(next);
        oracle.publish(_reading(1788717636));
        assertEq(oracle.latest().crawledAt, 1788717636);
    }

    function test_setWriter_revertsForNonOwner() public {
        vm.prank(writerAddr);
        vm.expectRevert(LedgeOracle.NotOwner.selector);
        oracle.setWriter(strangerAddr);
    }

    // -------------------------------------------------------------- ownership

    function test_transferOwnership_isTwoStep() public {
        address next = address(0xFEE);

        vm.expectEmit(true, true, false, false, address(oracle));
        emit OwnershipTransferStarted(ownerAddr, next);
        vm.prank(ownerAddr);
        oracle.transferOwnership(next);

        // Step one changes nothing but the nomination.
        assertEq(oracle.owner(), ownerAddr);
        assertEq(oracle.pendingOwner(), next);

        vm.expectEmit(true, true, false, false, address(oracle));
        emit OwnerTransferred(ownerAddr, next);
        vm.prank(next);
        oracle.acceptOwnership();

        assertEq(oracle.owner(), next);
        assertEq(oracle.pendingOwner(), address(0));
    }

    function test_transferOwnership_revertsForNonOwner() public {
        vm.prank(strangerAddr);
        vm.expectRevert(LedgeOracle.NotOwner.selector);
        oracle.transferOwnership(strangerAddr);
    }

    function test_acceptOwnership_revertsForAnyoneButThePendingOwner() public {
        vm.prank(ownerAddr);
        oracle.transferOwnership(address(0xFEE));

        vm.prank(strangerAddr);
        vm.expectRevert(LedgeOracle.NotPendingOwner.selector);
        oracle.acceptOwnership();
    }

    function test_acceptOwnership_revertsWhenNoTransferIsPending() public {
        vm.prank(strangerAddr);
        vm.expectRevert(LedgeOracle.NotPendingOwner.selector);
        oracle.acceptOwnership();
    }

    function test_ownershipTransfer_theOldOwnerKeepsControlUntilAccepted() public {
        vm.prank(ownerAddr);
        oracle.transferOwnership(address(0xFEE));

        vm.prank(address(0xFEE));
        vm.expectRevert(LedgeOracle.NotOwner.selector);
        oracle.setWriter(strangerAddr);

        vm.prank(ownerAddr);
        oracle.setWriter(strangerAddr);
        assertEq(oracle.writer(), strangerAddr);
    }

    // ---------------------------------------------------------- no value sink

    function test_contract_rejectsPlainEther() public {
        vm.deal(strangerAddr, 1 ether);
        vm.prank(strangerAddr);
        (bool ok,) = address(oracle).call{value: 1 wei}("");
        assertFalse(ok);
        assertEq(address(oracle).balance, 0);
    }
}
