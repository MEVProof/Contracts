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

var seed = 1;
function random() {
    var x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
}

const TokenA = artifacts.require("TokenA");
const TokenB = artifacts.require("TokenB");

const precision = 1000;
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
    newcommitment: rbigint(31).toString()
    
  }
  deposit.commitment = web3.utils.soliditySha3(web3.eth.abi.encodeParameters(['uint256','uint256'], [deposit.nullifier, deposit.randomness] ));
  return deposit;
}

function generateBuyOrders(accounts) {
  let buyOrders =[];
  for (let step = 0; step < numOrders; step++) {
    // buyOrders.push(new  Utils.Order( true, 
    //   Math.floor(Math.random() * orderSize*2),
    //   Math.floor(Math.random() * fairPrice*2),
    //   10000,
    //   accounts[step]
    //   ));
    buyOrders.push(new  Utils.Order( true, 
      Math.floor(random() * orderSize*2)*fairPrice *precision,
      Math.floor(random() * fairPrice*3),
      10000,
      accounts[step]
      ));
  }
  return buyOrders;
}

function generateSellOrders(accounts) {
  let sellOrders =[];
  // for (let step = numOrders; step < 2*numOrders; step++) {
  //   sellOrders.push( new  Utils.Order( false, 
  //     Math.floor(Math.random() * orderSize*2),
  //     Math.floor(Math.random() * fairPrice*2),
  //     10000,
  //     accounts[step]
  //     ));
  // }
  for (let step = numOrders; step < 2*numOrders; step++) {
    sellOrders.push( new  Utils.Order( false, 
      Math.floor(random() * orderSize*2)*precision,
      Math.floor(random() * fairPrice),
      10000,
      accounts[step]
      ));
  }
  return sellOrders;
}

function generateDeposits() {
  let deposits=[];
  for (let step = 0; step < numOrders; step++) {
    let deposit = {
      nullifier: rbigint(31).toString(),
      randomness: rbigint(31).toString(),
      newcommitment: web3.utils.soliditySha3(rbigint(31).toString())
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
    commits.push({
        _proof: web3.eth.abi.encodeParameter('uint256',proof),
        _root: web3.eth.abi.encodeParameter('uint256',root),
        _nullifierHash: web3.utils.soliditySha3(deposits[step].nullifier),
    });
  }
  return commits;
}

function generateMarkets(accounts) {
  let markets=[];
  // for (let step = 2*numOrders; step <(2*numOrders)+ numMarkets; step++) {
  //   let mids=fairPrice + ( Math.floor(Math.random() * marketWidths*2)-marketWidths);
  //   let _market = new Utils.MarketMakerOrder(mids-Math.floor(marketWidths/2),
  //       Math.floor(Math.random() * orderSize)*fairPrice,
  //       mids+Math.floor(marketWidths/2),
  //       Math.floor(Math.random() * orderSize),
  //       accounts[step]);
  //   markets.push(_market);
  // }
  for (let step = 2*numOrders; step <(2*numOrders)+ numMarkets; step++) {
    let mids=fairPrice + ( Math.floor(random() * marketWidths*2)-marketWidths);
    let _market = new Utils.MarketMakerOrder(mids-Math.floor(marketWidths/2),
        Math.floor(random() * orderSize)*fairPrice*precision,
        mids+Math.floor(marketWidths/2),
        Math.floor(random() * orderSize)*precision,
        accounts[step]);
    markets.push(_market);
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
  let wTight;
  let numBlockchainBuys;
  let numBlockchainSells;
  let blockchainBuyOrders=[];
  let blockchainSellOrders=[];


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


  // let pawn = accounts[0];
  // let relayer = accounts[1];
  // let bishop = accounts[2];
  // let knight = accounts[3];
  // const deposit = Utils.GenerateDeposit();
  // const newDeposit = Utils.GenerateDeposit();
  // const order = new Utils.Order(true, 500, 100, 10000, pawn);
  // let proof= rbigint(31).toString();
  // let root= rbigint(31).toString();
  // const clientCommitInput = {
  //   _orderHash: order.GetSolidityHash(),
  //   _proof: web3.eth.abi.encodeParameter('uint256', proof),
  //   _root: web3.eth.abi.encodeParameter('uint256', root),
  //   _nullifierHash: deposit.nullifierHash,
  // };
  // const market = new Utils.MarketMakerOrder(99, 10000, 100, 10, bishop);

  it("should be deployed", async function () {
    inst = await CnM.deployed();
    tknA = await TokenA.deployed(); 
    tknB = await TokenB.deployed();
  });

  // it('mint and approve tokens', async function () {
  //   await tknA.mint(pawn, 1000);
  //   await tknB.mint(knight, 1000);
  //   await tknA.mint(bishop, 100000);
  //   await tknB.mint(bishop, 100000);
  //   await tknA.approve(inst.address, 1000, {from: pawn});
  //   await tknB.approve(inst.address, 1000, {from: relayer});
  //   await tknA.approve(inst.address, 100000, {from: bishop});
  //   await tknB.approve(inst.address, 100000, {from: bishop});

  // });

  // it("should register properly", async function () {  
  //   reg = await inst.Client_Register(deposit.commitment,{from: pawn, value: clientDepositAmount});  
  // });
  // // it("should not register properly", async function () {
  // //   reg = await expectRevert(inst.Client_Register(web3.utils.asciiToHex('0'),{from: pawn, value: oneEth}), 'Client register must deposit escrow + relayer fee');
  // // });
  // it("should add client commitment:", async function () {
  //   reg = await inst.Client_Commit(order.GetSolidityHash(), clientCommitInput._proof, clientCommitInput._root, clientCommitInput._nullifierHash,  {from: relayer});
  // });
  // it("should add MM commitment:", async function () {
  //   reg = await inst.MM_Commit(market.GetSolidityHash(),  {from: bishop, value: tenEth});
  // });
  // it("should move to Reveal phase", async function () {
  //   reg= await inst.Move_To_Reveal_Phase();
  // });
  // it("should reveal client order", async function () {
  //   reg = await inst.Client_Reveal(order.GetSolidityHash(), order.Unwrap(), deposit.nullifier, deposit.randomness, deposit.commitment, newDeposit.commitment, {from: pawn, value: oneEth});
  // });
  // it("should reveal MM market", async function () {  
  //   reg = await inst.MM_Reveal(market.GetSolidityHash(), market,   {from: bishop});
  // });



  it('mint and approve tokens', async function () {
    for (let step = 0; step < numOrders; step++) {
      await tknA.mint(accounts[step], orderSize*orderSize*precision);
      await tknB.mint(accounts[numOrders+step], orderSize*orderSize*precision);
      await tknA.approve(inst.address, orderSize*orderSize*precision, {from: accounts[step]});
      await tknB.approve(inst.address, orderSize*orderSize*precision, {from: accounts[numOrders+step]});
    }
    for (let step = 0; step < numMarkets; step++) {
      await tknA.mint(accounts[(2*numOrders)+step], orderSize*orderSize*fairPrice*precision);
      await tknB.mint(accounts[(2*numOrders)+step], orderSize*orderSize*fairPrice*precision);
      await tknA.approve(inst.address, orderSize*orderSize*fairPrice*precision, {from: accounts[(2*numOrders)+step]});
      await tknB.approve(inst.address, orderSize*orderSize*fairPrice*precision, {from: accounts[(2*numOrders)+step]});
    }
  });
  it("should register properly", async function () {
    for (let step = 0; step < numOrders; step++) {
      await inst.Client_Register(buyOrderDeposits[step].commitment, {from: accounts[step], value: clientDepositAmount});
      await inst.Client_Register(sellOrderDeposits[step].commitment, {from: accounts[numOrders+step], value: clientDepositAmount});
    }
  });
  it("should add client commitments", async function () {
    for (let step = 0; step < numOrders; step++) {
      await inst.Client_Commit(buyOrders[step].GetSolidityHash(), buyCommitInputs[step]._proof, buyCommitInputs[step]._root, buyCommitInputs[step]._nullifierHash,  {from: accounts[step]});
      await inst.Client_Commit(sellOrders[step].GetSolidityHash(), sellCommitInputs[step]._proof, sellCommitInputs[step]._root, sellCommitInputs[step]._nullifierHash,  {from: accounts[numOrders+step]});    
    }
  });
  it("should add MM commitments", async function () {
    for (let step = 0; step < numMarkets; step++) {
      await inst.MM_Commit(markets[step].GetSolidityHash(), {from: accounts[(2*numOrders)+step], value: tenEth});    
    }
  });
  it("should move to Reveal phase", async function () {
    reg= await inst.Move_To_Reveal_Phase();
  });
  it("should reveal clients", async function () {
    for (let step = 0; step < numOrders; step++) {
      await inst.Client_Reveal(buyOrders[step].GetSolidityHash(), buyOrders[step].Unwrap(), buyOrderDeposits[step].nullifier, buyOrderDeposits[step].randomness, buyOrderDeposits[step].commitment, buyOrderDeposits[step].newcommitment, {from: accounts[step], value: oneEth});
      await inst.Client_Reveal(sellOrders[step].GetSolidityHash(), sellOrders[step].Unwrap(), sellOrderDeposits[step].nullifier, sellOrderDeposits[step].randomness, sellOrderDeposits[step].commitment, sellOrderDeposits[step].newcommitment,  {from: accounts[numOrders+step], value: oneEth});    
    }
  });
  it("should reveal MMs", async function () {
    for (let step = 0; step < numMarkets; step++) {
      await inst.MM_Reveal(markets[step].GetSolidityHash(), markets[step], {from: accounts[(2*numOrders)+step]});    
    }
  });
  it("get Clearing Price Info", async function () {  
    minTickSize = await inst._getMinTickSize();
    numBlockchainBuys = await inst._getNumBuyOrders();
    numBlockchainSells = await inst._getNumSellOrders();
    wTight = Number(await inst._getWidthTight());
    for (let step = 0; step < numBlockchainBuys; step++) {
      let w= Number(await inst._getBuyOrderWidth(step));
      if (w >= wTight){

        let p= await inst._getBuyOrderPrice(step);
        let s= await inst._getBuyOrderSize(step);
        blockchainBuyOrders.push({
          _price: Number(p.toString()),
          _size: Number(s.toString())
        });
      }
    }
    for (let step = 0; step < numBlockchainSells; step++) {
      let w= await inst._getSellOrderWidth(step);
      if (w >= wTight){
        let p= await inst._getSellOrderPrice(step);
        let s= await inst._getSellOrderSize(step);
        blockchainSellOrders.push({
          _price: Number(p.toString()),
          _size: Number(s.toString())
        });
      }
    }
    console.log('blockchain buy orders:', blockchainBuyOrders);
    console.log('blockchain sell orders:', blockchainSellOrders);
  });
  it("should settle orders", async function () {
    
    // console.log('contract balance A: ',await tknA.balanceOf(inst.address));
    // console.log('contract balance B: ',await tknB.balanceOf(inst.address));
    let clearingInfo= getClearingPrice(blockchainBuyOrders,blockchainSellOrders, minTickSize);
    console.log('clearing price:',clearingInfo.clearingPrice, ', volume settled in token A:', clearingInfo.volumeSettled, ', imbalance:', clearingInfo.imbalance);
    reg = await inst.Settlement(clearingInfo.clearingPrice, clearingInfo.volumeSettled, clearingInfo.imbalance ,   {from: accounts[0], gasLimit: 10000000});
    expectEvent(reg, "HeresTrouble", {checkNumber:-1, returnToSender: 1, remainder: 1 });

    // console.log('post exchange pawn balance A: ',await tknA.balanceOf(pawn));
    // console.log('post exchange pawn balance B: ',await tknB.balanceOf(pawn));
    // console.log('post exchange bishop balance A: ',await tknA.balanceOf(bishop));
    // console.log('post exchange bishop balance B: ',await tknB.balanceOf(bishop));
    // console.log('contract balance A: ',await tknA.balanceOf(inst.address));
    // console.log('contract balance B: ',await tknB.balanceOf(inst.address));

  });

});

function getClearingPrice(buyOrders, sellOrders, minTickSize ) {
  let _numBuys=buyOrders.length;
  let _numSells=sellOrders.length;
  let _prices=[];

  for (let step = 0; step < _numBuys; step++) {
      if(_prices.indexOf(buyOrders[step]._price)==-1){
        _prices.push(buyOrders[step]._price);
      }
  }
  for (let step = 0; step < _numSells; step++) {
      if(_prices.indexOf(sellOrders[step]._price)==-1){
        _prices.push(sellOrders[step]._price);
      }
  }
  //console.log('check1:', _prices);
  _prices=_prices.sort(function(a, b){return a - b});
  //console.log('check2:', _prices);
  let _numPricePoints= _prices.length;
  let _buyVolumes=[];
  let _sellVolumes=[];
  for (let step = 0; step < _numBuys; step++) {
    _buyVolumes[buyOrders[step]._price] = (_buyVolumes[buyOrders[step]._price] || 0)+ buyOrders[step]._size;
  }
  for (let step = 0; step < _numSells; step++) {
    _sellVolumes[sellOrders[step]._price] = (_sellVolumes[sellOrders[step]._price] || 0 ) +sellOrders[step]._size;
  }
  //console.log('check3.1:', _buyVolumes);
  //console.log('check3.2:', _sellVolumes);
  for (let step = 0; step < _numPricePoints-1; step++) {
    _buyVolumes[_prices[(_numPricePoints-2)-step]] = (_buyVolumes[_prices[(_numPricePoints-2)-step]]|| 0) + (_buyVolumes[_prices[(_numPricePoints-1)-step]] || 0);
    _sellVolumes[_prices[1+step]] = (_sellVolumes[_prices[1+step]]||0) + (_sellVolumes[_prices[step]]||0);
  }

  let _clearingVolumes = [];
  for (let step = 0; step < _numPricePoints; step++) {
    _clearingVolumes[_prices[step]]=Math.min((_buyVolumes[_prices[step]]||0), (_sellVolumes[_prices[step]]||0)*_prices[step]);
  }
  //console.log('check4:', _clearingVolumes);
  let _maxVolume=0;
  let _clearingPrice=-1;
  for (let step = 0; step < _numPricePoints; step++) {
    if (_clearingVolumes[_prices[step]]>_maxVolume){
      _maxVolume = _clearingVolumes[_prices[step]];
      _clearingPrice=_prices[step];
    }
  }
  //console.log('check4.1:', _maxVolume);
  let _imbalances = [];
  for (let step = 0; step < _numPricePoints; step++) {
    _imbalances[_prices[step]]=_buyVolumes[_prices[step]]-(_sellVolumes[_prices[step]]*_prices[step]);
  }
  
  
  //console.log('check4.2:', _clearingVolumes.indexOf(_maxVolume));
  let _imbalance= _imbalances[_clearingPrice];
  //console.log('check5:', _clearingPrice, _imbalance);
  let _buyVolumeFinal=0;
  let _sellVolumeFinal= 0;

  if (_imbalance > 0){
    for (let step = 0; step < _numBuys; step++) {
      if (buyOrders[step]._price > _clearingPrice){
        _buyVolumeFinal += buyOrders[step]._size;
      }
      
    }
    for (let step = 0; step < _numSells; step++) {
      if (sellOrders[step]._price <= _clearingPrice){
        _sellVolumeFinal += sellOrders[step]._size;
      }
      
    }
    let _upperbound = _prices[_prices.indexOf(_clearingPrice)+1];
    let _newImbalance = _buyVolumeFinal - (_sellVolumeFinal*(_clearingPrice+minTickSize));
    while(_maxVolume == Math.min(_buyVolumeFinal, _sellVolumeFinal*(_clearingPrice+minTickSize)) && Math.abs(_newImbalance)<Math.abs(_imbalance) && _clearingPrice+minTickSize<_upperbound){
      _clearingPrice+=minTickSize;
      _imbalance=_newImbalance;
      _newImbalance=_buyVolumeFinal- (_sellVolumeFinal*(_clearingPrice+minTickSize));
    }
      

  } else {
    for (let step = 0; step < _numBuys; step++) {
      if (buyOrders[step]._price >= _clearingPrice){
        _buyVolumeFinal += buyOrders[step]._size;
      }
      
    }
    for (let step = 0; step < _numSells; step++) {
      if (sellOrders[step]._price < _clearingPrice){
        _sellVolumeFinal += sellOrders[step]._size;
      }
      
    }
    let _lowerbound = _prices[_prices.indexOf(_clearingPrice)-1];
    let _newImbalance = _buyVolumeFinal - (_sellVolumeFinal*(_clearingPrice-minTickSize));
    while(_maxVolume == Math.min(_buyVolumeFinal, _sellVolumeFinal*(_clearingPrice-minTickSize)) && Math.abs(_newImbalance)<Math.abs(_imbalance) && _clearingPrice-minTickSize>_lowerbound){
      _clearingPrice-=minTickSize;
      _imbalance=_newImbalance;
      _newImbalance=_buyVolumeFinal- (_sellVolumeFinal*(_clearingPrice-minTickSize));
    }
      

  }

  return {clearingPrice: _clearingPrice,
          volumeSettled: _maxVolume,
          imbalance: _imbalance
        };
}
