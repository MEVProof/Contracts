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


const fairPrice = 100;
const numOrders = 4;
const numMarkets = 2;
const marketWidths = 5;
const orderSize = 1000;

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

function generateBuyOrders(accounts) {
  let buyOrders =[];
  for (let step = 0; step < numOrders; step++) {
    buyOrders.push({
        _isBuyOrder: '1',
        _size: Math.floor(Math.random() * orderSize*2),
        _price:  Math.floor(Math.random() * fairPrice*2),
        _maxTradeableWidth:  '10000',
        _owner: accounts[step]
    });
  }
  return buyOrders;
}

function generateSellOrders(accounts) {
  let sellOrders =[];
  for (let step = numOrders; step < 2*numOrders; step++) {
    sellOrders.push({
        _isBuyOrder: '0',
        _size: Math.floor(Math.random() * orderSize*2),
        _price:  Math.floor(Math.random() * fairPrice*2),
        _maxTradeableWidth:  '10000',
        _owner: accounts[step]
    });
  }
  return sellOrders;
}

function generateDeposits() {
  let deposits=[];
  for (let step = 0; step < numOrders; step++) {
    let deposit = {
      nullifier: rbigint(31).toString(),
      randomness: rbigint(31).toString(),
    };
    deposit.commitment = web3.utils.soliditySha3(web3.eth.abi.encodeParameters(['uint256','uint256'], [deposit.nullifier, deposit.randomness] ));
    deposits.push(deposit);
  }
  return deposits;
}

function generateClientCommitInfo(orders, deposits) {
  let commits=[]; 
  for (let step = 0; step < numOrders; step++) {
    let proof= rbigint(31).toString();
    let root= rbigint(31).toString();
  
    let orderPreimage = web3.eth.abi.encodeParameters(['uint256','uint256','uint256','uint256'],[orders[step]._isBuyOrder, orders[step]._size,orders[step]._price,orders[step]._maxTradeableWidth]);
    let orderHash= web3.utils.soliditySha3(orderPreimage);
    commits.push({
        _orderHash:  orderHash,
        _proof: web3.eth.abi.encodeParameter('uint256',proof),
        _root: web3.eth.abi.encodeParameter('uint256',root),
        _nullifierHash: web3.utils.soliditySha3(deposits[step].nullifier),
    });
  }
  return commits;
}

function generateMarkets(accounts) {
  let markets=[];
  for (let step = 2*numOrders; step <(2*numOrders)+ numMarkets; step++) {
    let mids=fairPrice + ( Math.floor(Math.random() * marketWidths*2)-marketWidths);
    let _market = {
        _bidPrice: mids-Math.floor(marketWidths/2),
        _bidSize: Math.floor(Math.random() * orderSize*orderSize)*fairPrice,
        _offerPrice:  mids+Math.floor(marketWidths/2),
        _offerSize:  Math.floor(Math.random() * orderSize*orderSize),
        _owner: accounts[step]
    };
    let marketPreimage = web3.eth.abi.encodeParameters(['uint256','uint256','uint256','uint256'],[_market._bidPrice, _market._bidSize,_market._offerPrice,_market._offerSize])
    let _marketHash= web3.utils.soliditySha3(marketPreimage);
    markets.push({market:_market ,marketHash:_marketHash});
  }
  return markets;
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
  let minTickSize;
  let pawn = accounts[0];
  let relayer = accounts[1];
  let bishop = accounts[2];
  let knight = accounts[3];

  const buyOrders = generateBuyOrders(accounts);
  const sellOrders = generateSellOrders(accounts);
  const buyOrderDeposits = generateDeposits();
  const sellOrderDeposits = generateDeposits();
  const buyCommitInputs = generateClientCommitInfo(buyOrders, buyOrderDeposits);
  const sellCommitInputs = generateClientCommitInfo(sellOrders, sellOrderDeposits);
  const markets = generateMarkets(accounts);
  // console.log(buyOrders);
  // console.log(sellOrders);
  // console.log(markets);

  const deposit = Utils.GenerateDeposit();
  const newDeposit = Utils.GenerateDeposit();
  const order = new Utils.Order(true, 500, 100, 10000, pawn);

  let proof= rbigint(31).toString();
  let root= rbigint(31).toString();
  
  const clientCommitInput = {
    _orderHash: order.GetSolidityHash(),
    _proof: web3.eth.abi.encodeParameter('uint256', proof),
    _root: web3.eth.abi.encodeParameter('uint256', root),
    _nullifierHash: deposit.nullifierHashHex,
  };

  const market = new Utils.MarketMakerOrder(99, 10000, 100, 10, bishop);

  it("should be deployed", async function () {
    inst = await CnM.deployed();
    tknA = await TokenA.deployed(); 
    tknB = await TokenB.deployed();
    minTickSize = await inst.getMinTickSize.call();
  });

  console.log('min tick size:',minTickSize);

  it('mint and approve tokens', async function () {
    await tknA.mint(pawn, 1000);
    await tknB.mint(knight, 1000);
    await tknA.mint(bishop, 100000);
    await tknB.mint(bishop, 100000);
    await tknA.approve(inst.address, 1000, {from: pawn});
    await tknB.approve(inst.address, 1000, {from: relayer});
    await tknA.approve(inst.address, 100000, {from: bishop});
    await tknB.approve(inst.address, 100000, {from: bishop});
  });

  it("should register properly", async function () {  
    reg = await inst.Client_Register(deposit.commitmentHex,{from: pawn, value: clientDepositAmount});  
  });

  it("should not register properly", async function () {
    reg = await expectRevert(inst.Client_Register(web3.utils.asciiToHex('0'),{from: pawn, value: oneEth}), 'Client register must deposit escrow + relayer fee');
  });

  it("should add client commitment:", async function () {
    reg = await inst.Client_Commit(order.GetSolidityHash(), clientCommitInput._proof, clientCommitInput._root, clientCommitInput._nullifierHash,  {from: relayer, gasLimit: 10000000});
  });

  // it("should add MM commitment:", async function () {
  //   reg = await inst.MM_Commit(market.GetSolidityHash(),  {from: bishop, value: tenEth});
  // });

  // it("should move to Reveal phase", async function () {
  //   reg= await inst.Move_To_Reveal_Phase();
  // });

  // it("should reveal client order", async function () {
  //   reg = await inst.Client_Reveal(order.GetSolidityHash(), order.Unwrap(), deposit.nullifierHex, deposit.randomnessHex, deposit.commitmentHex, newDeposit.commitmentHex, {from: pawn, value: oneEth});
  // });

  // it("should reveal MM market", async function () {  
  //   reg = await inst.MM_Reveal(market.GetSolidityHash(), market,   {from: bishop});
  // });


  // it('mint and approve tokens', async function () {
  //   for (let step = 0; step < numOrders; step++) {
  //     await tknA.mint(accounts[step], orderSize);
  //     await tknB.mint(accounts[numOrders+step], orderSize);
  //     await tknA.approve(inst.address, orderSize, {from: accounts[step]});
  //     await tknB.approve(inst.address, orderSize, {from: accounts[numOrders+step]});
  //   }
  //   for (let step = 0; step < numMarkets; step++) {
  //     await tknA.mint(accounts[(2*numOrders)+step], orderSize*orderSize);
  //     await tknB.mint(accounts[(2*numOrders)+step], orderSize*orderSize);
  //     await tknA.approve(inst.address, orderSize*orderSize, {from: (2*numOrders)+step});
  //     await tknB.approve(inst.address, orderSize*orderSize, {from: (2*numOrders)+step});
  //   }
  // });
  // it("should register properly", async function () {
  //   for (let step = 0; step < numOrders; step++) {
  //     await inst.Client_Register(buyOrderDeposits[step].commitment, {from: accounts[step], value: clientDepositAmount});
  //     await inst.Client_Register(sellOrderDeposits[step].commitment, {from: accounts[numOrders+step], value: clientDepositAmount});
  //   }
  // });
  // it("should add client commitments", async function () {
  //   for (let step = 0; step < numOrders; step++) {
  //     await inst.Client_Commit(buyCommitInputs[step]._orderHash, buyCommitInputs[step]._proof, buyCommitInputs[step]._root, buyCommitInputs[step]._nullifierHash,  {from: accounts[step]});
  //     await inst.Client_Commit(sellCommitInputs[step]._orderHash, sellCommitInputs[step]._proof, sellCommitInputs[step]._root, sellCommitInputs[step]._nullifierHash,  {from: accounts[numOrders+step]});    
  //   }
  // });
  // it("should add MM commitments", async function () {
  //   for (let step = 0; step < numMarkets; step++) {
  //     await inst.MM_Commit(markets[step].marketHash, {from: accounts[(2*numOrders)+step], value: tenEth});    
  //   }
  // });
  // it("should reveal clients", async function () {
  //   for (let step = 0; step < numOrders; step++) {
  //     await inst.Client_Reveal(buyCommitInputs[step]._orderHash, buyOrders[step], buyOrderDeposits[step].nullifier, buyOrderDeposits[step].randomness, buyOrderDeposits[step].commitment,  {from: accounts[step]});
  //     await inst.Client_Reveal(sellCommitInputs[step]._orderHash, sellOrders[step], sellOrderDeposits[step].nullifier, sellOrderDeposits[step].randomness, sellOrderDeposits[step].commitment,   {from: accounts[numOrders+step]});    
  //   }
  // });
  // it("should reveal MMs", async function () {
  //   for (let step = 0; step < numMarkets; step++) {
  //     await inst.MM_Reveal(markets[step].marketHash, markets[step].market, {from: accounts[(2*numOrders)+step]});    
  //   }
  // });

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

function getClearingPrice() {
  let deposit = {
    nullifier: rbigint(31).toString(),
    randomness: rbigint(31).toString(),
    
  }
  
  deposit.commitment = web3.utils.soliditySha3(web3.eth.abi.encodeParameters(['uint256','uint256'], [deposit.nullifier, deposit.randomness] ));
  
  return deposit;
}