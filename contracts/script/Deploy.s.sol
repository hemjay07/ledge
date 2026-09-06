// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {LedgeOracle} from "../src/LedgeOracle.sol";

/// @notice One-time deployment of LedgeOracle.
/// @dev Run with the deployer key (which becomes `owner`) and the publishing address in
///      LEDGE_ORACLE_WRITER. The writer may equal the deployer for a first bring-up and be
///      rotated afterwards with `setWriter`; the README runbook keeps them separate.
///
///      LEDGE_ORACLE_WRITER=0x... forge script script/Deploy.s.sol:Deploy \
///        --rpc-url "$ETH_RPC_URL" --broadcast --interactives 1
contract Deploy is Script {
    function run() external returns (LedgeOracle oracle) {
        address writer = vm.envAddress("LEDGE_ORACLE_WRITER");

        vm.startBroadcast();
        oracle = new LedgeOracle(writer);
        vm.stopBroadcast();

        console.log("LedgeOracle deployed at", address(oracle));
        console.log("owner ", oracle.owner());
        console.log("writer", oracle.writer());
    }
}
