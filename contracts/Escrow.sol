// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.4.22 <0.9.0;

contract Escrow {
    uint256 depositReceipt ;
    mapping(uint256 => uint) deposits;
    uint totalDeposits;

    event DepositCreated(uint256 depositId, uint amount);
    event DepositClaimed(uint256 depositId, uint amount);
    event WithdrawalFailed(uint256 depositId);

    constructor(){
      depositReceipt = 1;
    }

    function Deposit() public payable returns (uint256 depositId) {
        require(msg.value > 0, "msg.value must be > 0 to deposit");

        depositId = depositReceipt++;

        deposits[depositId] = msg.value;
        totalDeposits += msg.value;

        emit DepositCreated(depositId, msg.value);

        return depositId;
    }

    function Withdraw(uint256 depositId) public returns (bool successful) {
        require(deposits[depositId] > 0, "Deposit not found or already withdrawn");
        
        uint256 pendingAmount = deposits[depositId];

        if (pendingAmount == 0) {
            return false;
        }

        deposits[depositId] = 0;

        (bool success, ) = msg.sender.call{value:pendingAmount}("");
        
        if (!success) {
            deposits[depositId] = pendingAmount;

            emit WithdrawalFailed(depositId);

            return false;
        }

        totalDeposits -= pendingAmount;

        emit DepositClaimed(depositId, pendingAmount);

        return true;
    }

    function CheckDeposit(uint256 depositId) public view returns (uint depositBalance) {
        return deposits[depositId];
    }

    function GetTotalValueOfDeposits() public view returns (uint256 depositReceipt_, uint totalDeposits_) {
        return (depositReceipt, totalDeposits);
    }
}