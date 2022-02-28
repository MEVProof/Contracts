const CnM = artifacts.require("ClientAndMM");



const {
  //  BN,           // Big Number support
  constants,    // Common constants, like the zero address and largest integers
  expectEvent,  // Assertions for emitted events
  expectRevert, // Assertions for transactions that should fail
  balance,
  send
} = require('@openzeppelin/test-helpers');

const BN = require('bn.js');
const chai = require('chai');
const chaiBn = require('chai-bn');
chai.use(chaiBn(BN));

const ether = require('@openzeppelin/test-helpers/src/ether');

const expect = chai.expect;

contract("ClientAndMM", async function (accounts) {
  const oneEth = 1;
  const clientDepositAmount = 3;
  var assert = require('assert');
  let inst;
  let reg;
  let tracker;
  let pawn = accounts[0];
  let knight = accounts[1];


  
  it("should be deployed", async function () {
    
    inst = await CnM.deployed();
    let balance = await inst._getPlayerBalance({from: pawn});
    console.log(balance);
    balance = await inst._getContractBalance();
    console.log(balance);
  });

  

  it("should register properly", async function () {
    

    reg = await inst.Client_Register(web3.utils.asciiToHex('0'),{from: pawn, value: clientDepositAmount});
    console.log(reg);
    assert(reg);

    reg = await inst._checkRegIDs(web3.utils.asciiToHex('0'));
    console.log('legit registration',reg);

    //assert(reg);

    reg = await inst._checkRegIDs(web3.utils.asciiToHex('1'));
    console.log('illegit registration', reg);
    //assert(reg==false);

    
    let balance = await inst._getPlayerBalance({from: pawn});
    console.log(balance);
    balance = await inst._getContractBalance();
    console.log(balance);
  });

  it("should not register properly", async function () {
    
    reg = await expectRevert(inst.Client_Register(web3.utils.asciiToHex('0'),{from: pawn, value: oneEth}), 'Client register must deposit escrow + relayer fee');
    
  });

  it("should not register properly", async function () {
    
    reg = await expectRevert(inst.Client_Register(web3.utils.asciiToHex('0'),{from: pawn, value: oneEth}), 'Client register must deposit escrow + relayer fee');
    
  });
 
});