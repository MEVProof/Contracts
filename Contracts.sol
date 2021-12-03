// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.4.0 <0.9.0;

contract FairTraDEX {
    uint depositReceipt;
    mapping (uint => uint) deposits;

    event DepositCreated(uint depositId, uint amount);
    event DepositClaimed(uint depositId, uint amount);

    function Deposit() public payable returns (uint) {
        uint depositId = depositReceipt++;
        
        deposits[depositId] = msg.value;

        emit DepositCreated(depositId, msg.value);

        return depositId;
    }

    function Withdraw(uint depositId) public returns (bool) { 
        uint pendingAmount = deposits[depositId];

        if (pendingAmount == 0){
            return false;
        }
        
        deposits[depositId] = 0;

        if (!payable(msg.sender).send(pendingAmount)){
            deposits[depositId] = pendingAmount;
            return false;
        }

        emit DepositClaimed(depositId, pendingAmount);

        return true;
    }
}