// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.4.22 <0.9.0;

import "truffle/Assert.sol";
import "truffle/DeployedAddresses.sol";
import "../contracts/Escrow.sol";

contract TestEscrow {
    uint public initialBalance = 5 ether;

    function testDepositAndWithdrawal() public {
        Escrow escrow = Escrow(DeployedAddresses.Escrow());

        uint depositId = escrow.Deposit{value: 1 ether}();
        Assert.equal(depositId, uint(1), "depositId should be 1");
        Assert.equal(address(this).balance, 4 ether, "balance should be 4 eth");

        uint depositValue = escrow.CheckDeposit(depositId);
        Assert.equal(depositValue, 1 ether, "depositValue should be 1 eth");

        (uint256 depositReceipt, uint totalDeposits) = escrow.GetTotalValueOfDeposits();
        Assert.equal(depositReceipt, 2, "receipts should be 2");
        Assert.equal(totalDeposits, 1 ether, "total deposits should be 1 eth");

        bool withdrawalSuccessful = escrow.Withdraw(depositId);
        Assert.isTrue(withdrawalSuccessful, "Withdrawal should succeed");
        Assert.equal(address(this).balance, 5 ether, "balance should be 5 eth");
    }

    receive() external payable {
        // Needed to receive Eth when claiming deposits
    }
}