// const Escrow = artifacts.require("Escrow");

// const {
//   //  BN,           // Big Number support
//   constants,    // Common constants, like the zero address and largest integers
//   expectEvent,  // Assertions for emitted events
//   expectRevert, // Assertions for transactions that should fail
//   balance,
//   send
// } = require('@openzeppelin/test-helpers');

// const BN = require('bn.js');
// const chai = require('chai');
// const chaiBn = require('chai-bn');
// chai.use(chaiBn(BN));

// const ether = require('@openzeppelin/test-helpers/src/ether');

// const expect = chai.expect;

// contract("Escrow", async function (accounts) {
//   const oneEth = ether('1');

//   let inst;
//   let ticket;
//   let tracker;

//   it("should be deployed", async function () {
//     inst = await Escrow.deployed();
//     tracker = await balance.tracker(accounts[0]);
//     await tracker.get();
//   });

//   it("should return ticket when deposit is placed", async function () {
//     let deposit_result = await inst.Deposit({ from: accounts[0], value: oneEth });
//     let deposit_event = expectEvent(deposit_result, "DepositCreated", { depositId: new BN(1), amount: oneEth });

//     ticket = deposit_event.args.depositId;

//     assert.notEqual(ticket, 0);
//   });

//   it("querying deposit should return correct balance", async function () {
//     let ticketValue = await inst.CheckDeposit.call(ticket);

//     expect(ticketValue).to.be.a.bignumber.equal(oneEth);
//   });

//   it("should return correct value for total deposits", async function () {
//     const totals = await inst.GetTotalValueOfDeposits.call();

//     expect(totals.depositReceipt_).to.be.a.bignumber.equal('2');
//     expect(totals.totalDeposits_).to.be.a.bignumber.equal(oneEth);
//   });

//   it("withdrawals return balance", async function () {
//     const accountValueBeforeWithdrawal = await tracker.get();

//     let withdraw_result = await inst.Withdraw(ticket);

//     const delta = await tracker.deltaWithFees();
//     const accountValueAfterWithdrawal = await tracker.get();

//     expectEvent(withdraw_result, "DepositClaimed", { depositId: ticket, amount: oneEth });

//     expect(accountValueAfterWithdrawal).to.be.a.bignumber.equal(accountValueBeforeWithdrawal.add(oneEth).sub(delta.fees));
//   });

//   it("double withdrawal fails", async function () {
//     await expectRevert(inst.Withdraw(ticket), "Deposit not found or already withdrawn");
//   });
// });