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

const expect = chai.expect;


const TokenA = artifacts.require("TokenA");
const TokenB = artifacts.require("TokenB");


// this stuff is used in the Torndado tests
const snarkjs = require('snarkjs')
const circomlib = require('circomlib');
const Utils = require('./Utils');

const pedersenHash = (data) => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]
const rbigint = (nbytes) => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes))
const toFixedHex = (number, length = 32) =>
  '0x' +
  bigInt(number)
    .toString(16)
    .padStart(length * 2, '0')
const getRandomRecipient = () => rbigint(20)



function generateDeposit() {
  let deposit = {
    nullifier: rbigint(31).toString(),
    randomness: rbigint(31).toString(),
    
  }
  
  deposit.commitment = web3.utils.soliditySha3(web3.eth.abi.encodeParameters(['uint256','uint256'], [deposit.nullifier, deposit.randomness] ));
  
  return deposit;
}



contract("ClientAndMM", async function (accounts) {
  const oneEth = 1;
  const tenEth =10;
  const clientDepositAmount = 3;
  var assert = require('assert');
  let inst;
  let reg;
  let tknA;
  let tknB;
  let pawn = accounts[0];
  let relayer = accounts[1];
  let bishop = accounts[2];
  let knight = accounts[3];


  const deposit = generateDeposit();
  const newDeposit = generateDeposit();
  const order = new Utils.Order(true, 500, 100, 10000, pawn);

  let proof= rbigint(31).toString();
  let root= rbigint(31).toString();
  
  const clientCommitInput = {
        _orderHash:  order.GetPreimage(),
        _proof: web3.eth.abi.encodeParameter('uint256',proof),
        _root: web3.eth.abi.encodeParameter('uint256',root),
        _nullifierHash: web3.utils.soliditySha3(deposit.nullifier),
        };

  const market = new Utils.MarketMakerOrder(99, 10000, 100, 10, bishop);

  it("should be deployed", async function () {    
    inst = await CnM.deployed();
    tknA = await TokenA.deployed(); 
    tknB = await TokenB.deployed();

    await tknA.mint(pawn, 1000);
    await tknB.mint(knight, 1000);
    await tknA.mint(bishop, 100000);
    await tknB.mint(bishop, 100000);
  });


  it('approve transfer', async function () {
    await tknA.approve(inst.address, 1000, {from: pawn});
    await tknB.approve(inst.address, 1000, {from: relayer});
    await tknA.approve(inst.address, 100000, {from: bishop});
    await tknB.approve(inst.address, 100000, {from: bishop});
  });

  

   it("should register properly", async function () {  
    reg = await inst.Client_Register(deposit.commitment,{from: pawn, value: clientDepositAmount});  

    
  });

  it("should not register properly", async function () {
    reg = await expectRevert(inst.Client_Register(web3.utils.asciiToHex('0'),{from: pawn, value: oneEth}), 'Client register must deposit escrow + relayer fee');
  });

  it("should add client commitment:", async function () {
    reg = await inst.Client_Commit(order.GetPreimage(), clientCommitInput._proof, clientCommitInput._root, clientCommitInput._nullifierHash,  {from: relayer});
  });

  it("should add MM commitment:", async function () {
    reg = await inst.MM_Commit(market.GetPreimage(),  {from: bishop, value: tenEth});
  });


  it("should move to Reveal phase", async function () {
    reg= await inst.Move_To_Reveal_Phase();
  });

  it("should reveal client order", async function () {
    reg = await inst.Client_Reveal(order.GetPreimage(), order.Unwrap(), deposit.nullifier, deposit.randomness, deposit.commitment, newDeposit.commitment, {from: pawn, value: oneEth});
  });


  // it("should not reveal 2nd client order", async function () {
  //  reg = await expectRevert(inst.Client_Reveal(orderHash, order, deposit.nullifier, deposit.randomness, deposit.commitment, newDeposit.commitment, {from: pawn, value: oneEth}), 'Second order from same player should not be possible');
  // });

  
  it("should reveal MM market", async function () {
    
    reg = await inst.MM_Reveal(market.GetPreimage(), market,   {from: bishop});

  });

  it("should settle orders", async function () {
    
    // console.log('contract balance A: ',await tknA.balanceOf(inst.address));
    // console.log('contract balance B: ',await tknB.balanceOf(inst.address));

    reg = expectEvent(await inst.Settlement('100', '500', '-500' ,   {from: bishop, gasLimit: 10000000}), "CheckerEvent1", { clearingPrice: new BN(100), buyVolume: new BN(500), sellVolume: new BN(10)});
    
    // console.log('post exchange pawn balance A: ',await tknA.balanceOf(pawn));
    // console.log('post exchange pawn balance B: ',await tknB.balanceOf(pawn));
    // console.log('post exchange bishop balance A: ',await tknA.balanceOf(bishop));
    // console.log('post exchange bishop balance B: ',await tknB.balanceOf(bishop));
    // console.log('contract balance A: ',await tknA.balanceOf(inst.address));
    // console.log('contract balance B: ',await tknB.balanceOf(inst.address));


  });


  // it("should not reveal 2nd market", async function () {
  //   reg = await expectRevert(inst.MM_Reveal(market.GetPreimage(), market,   {from: bishop}), 'Second market from same player should not be possible');
  //  });

 
});