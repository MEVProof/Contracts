

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


// setting seed equal to a constant generates predicatable randomness 
//so we can repeat tests if/ when they fail
var seed = Math.random();

function random() {
    var x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
}

const CnM = artifacts.require("ClientAndMM");
const TokenA = artifacts.require("TokenA");
const TokenB = artifacts.require("TokenB");


// these variables are used only to generate orders, and not "accessible" by the contracts/ CP calculator
// decimalPoints specifies the price precision, and 
//the precision to which orders are being settled correctly

const decimalPoints=10;
const precision = BigInt(Math.pow(10,decimalPoints));
const localFairPrice = BigInt(100);
const fairPrice = localFairPrice*precision;


// 2*numOrders +numMarkets must be at most 10 as there are only 10 accounts in truffle
const numOrders = 4;
const numMarkets = 2;
const marketWidths = BigInt(Math.floor(0.05*Number(fairPrice)));
const orderSize = BigInt(1000);

// this stuff is used in the Torndado tests
const snarkjs = require('snarkjs')
const circomlib = require('circomlib');
const Utils = require('./Utils');

const rbigint = (nbytes) => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes))


// all numbers are converted to BigInt so they can be passed to Solidity
function generateBuyOrders(accounts) {
  let buyOrders =[];
  for (let step = 0; step < numOrders; step++) {
    buyOrders.push(new  Utils.Order( true, 
      BigInt(Math.floor(random() * Number(orderSize)))*localFairPrice *precision,
      BigInt(Math.floor(random() * Number(localFairPrice)*3))*precision,
      marketWidths,
      accounts[step]
      ));
  }
  return buyOrders;
}

function generateSellOrders(accounts) {
  let sellOrders =[];
  for (let step = numOrders; step < 2*numOrders; step++) {
    sellOrders.push( new  Utils.Order( false, 
      BigInt(Math.floor(random() * Number(orderSize))) *precision,
      BigInt(Math.floor(random() * Number(localFairPrice)))*precision,
      marketWidths,
      accounts[step]
      ));
  }
  return sellOrders;
}

function generateDeposits() {
  let deposits=[];
  for (let step = 0; step < numOrders; step++) {
    //this deposit also generates a new commitment for client re-entry into the system 
    // (without secret keys though)
  
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
  for (let step = 2*numOrders; step <(2*numOrders)+ numMarkets; step++) {
    let mids=fairPrice +  BigInt(Math.floor(random() * Number(marketWidths)*2))-marketWidths;
    let _market = new Utils.MarketMakerOrder(mids-BigInt(Math.floor(Number(marketWidths)/2)),
        BigInt(Math.floor(random() * Number(orderSize)))*localFairPrice *precision,
        mids+BigInt(Math.floor(Number(marketWidths)/2)),
        BigInt(Math.floor(random() * Number(localFairPrice)))*precision,
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
  let clearingInfo;
  let blockchainDecimalPoints;

  //specifies amount of each token to mint/apporve for each player
  const mintSizeA=BigInt(orderSize*orderSize*localFairPrice*precision);
  const mintSizeB=BigInt(orderSize*orderSize*precision);

  const buyOrders = generateBuyOrders(accounts);
  const sellOrders = generateSellOrders(accounts);
  const buyOrderDeposits = generateDeposits();
  const sellOrderDeposits = generateDeposits();
  const buyCommitInputs = generateClientCommitInfo(buyOrders, buyOrderDeposits);
  const sellCommitInputs = generateClientCommitInfo(sellOrders, sellOrderDeposits);
  const markets = generateMarkets(accounts);

  it("should be deployed", async function () {
    inst = await CnM.deployed();
    tknA = await TokenA.deployed(); 
    tknB = await TokenB.deployed();
  });

  it('mint and approve tokens', async function () {
    for (let step = 0; step < numOrders; step++) {
      await tknA.mint(accounts[step], mintSizeA);
      await tknB.mint(accounts[numOrders+step], mintSizeB);
      await tknA.approve(inst.address, mintSizeA, {from: accounts[step]});
      await tknB.approve(inst.address, mintSizeB, {from: accounts[numOrders+step]});
    }
    for (let step = 0; step < numMarkets; step++) {
      await tknA.mint(accounts[(2*numOrders)+step], mintSizeA);
      await tknB.mint(accounts[(2*numOrders)+step], mintSizeB);
      await tknA.approve(inst.address, mintSizeA, {from: accounts[(2*numOrders)+step]});
      await tknB.approve(inst.address, mintSizeB, {from: accounts[(2*numOrders)+step]});
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

  //downloads order information from blockchain, and calculates clearing price locally
  //by calling getClearingPrice()
  it("get Clearing Price Info", async function () {  
    minTickSize = Number(await inst._getMinTickSize())/Number(precision);
    numBlockchainBuys = await inst._getNumBuyOrders();
    numBlockchainSells = await inst._getNumSellOrders();
    wTight = Number(await inst._getWidthTight());
    for (let step = 0; step < numBlockchainBuys; step++) {
      let w= Number(await inst._getBuyOrderWidth(step));
      if (w >= wTight){

        let p= await inst._getBuyOrderPrice(step);
        let s= await inst._getBuyOrderSize(step);
        blockchainBuyOrders.push({
          _price: Number(p.toString())/Number(precision),
          _size: Number(s.toString())/Number(precision)
        });
      }
    }
    for (let step = 0; step < numBlockchainSells; step++) {
      let w= await inst._getSellOrderWidth(step);
      if (w >= wTight){
        let p= await inst._getSellOrderPrice(step);
        let s= await inst._getSellOrderSize(step);
        blockchainSellOrders.push({
          _price: Number(p.toString())/Number(precision),
          _size: Number(s.toString())/Number(precision)
        });
      }
    }
    console.log('blockchain buy orders:', blockchainBuyOrders);
    console.log('blockchain sell orders:', blockchainSellOrders);
    for (let step = 0; step < blockchainBuyOrders.length ; step++) {
      blockchainBuyOrders[step]._size= blockchainBuyOrders[step]._size*Number(precision)
    }
    for (let step = 0; step < blockchainSellOrders.length ; step++) {
      blockchainSellOrders[step]._size= blockchainSellOrders[step]._size*Number(precision)
    }
  });

  // due to rounding errors, buyVol, sellVol, CP and imbalance are improbable to match on chain
  // this function uses the correctly computed clearing price to back out these values
  // as Solidity does. It is currently an on-chain computation, but running Solidity locally
  // would suffice. 
  it("convert clearing price info to satisfy on-chain requirements", async function () {  
    clearingInfo= getClearingPrice(blockchainBuyOrders,blockchainSellOrders, minTickSize);
    clearingInfo.clearingPrice=BigInt(Math.round(Number(clearingInfo.clearingPrice)*Number(precision)));
    await inst.clearingPriceConvertor(clearingInfo.clearingPrice, BigInt(Math.floor(Number(clearingInfo.volumeSettled))), BigInt(Math.floor(Number(clearingInfo.imbalance))) ,   {from: accounts[0], gasLimit: 10000000})
    clearingInfo.volumeSettled= BigInt(Number(await inst._getSolVolumeSettled()));
    clearingInfo.imbalance= BigInt(Number(await inst._getSolImbalance()));
    console.log('clearing price:',Number(clearingInfo.clearingPrice)/Number(precision), ', volume settled in token A:', Number(clearingInfo.volumeSettled)/Number(precision), ', imbalance:', Number(clearingInfo.imbalance)/Number(precision));
  });


  it("should settle orders", async function () {
    reg = await inst.Settlement(clearingInfo.clearingPrice, clearingInfo.volumeSettled, clearingInfo.imbalance,   {from: accounts[0], gasLimit: 10000000, value: oneEth});
  });

  // a checker function to ensure settlement is done as expected.
  it("check client order settlement", async function () {
    let theoreticABalance;
    let theoreticBBalance;
    let actualABalance;
    let actualBBalance;
    let _CP=Number(clearingInfo.clearingPrice)/Number(precision);
    for (let step = 0; step < numOrders; step++) {
      actualABalance= Number(await tknA.balanceOf(accounts[step]))/Number(precision);
      actualBBalance= Number(await tknB.balanceOf(accounts[step]))/Number(precision);
      //not checking properly for imbalance yet
      if (_CP<blockchainBuyOrders[step]._price){
        theoreticABalance= (Number(mintSizeA)-blockchainBuyOrders[step]._size)/Number(precision);
        theoreticBBalance= (Number(blockchainBuyOrders[step]._size)/_CP)/Number(precision);
      } else{
        theoreticABalance=Number(mintSizeA/precision);
        theoreticBBalance=0;
      }

      console.log('Account ', step ,'. expected A balance:', theoreticABalance, ', actual A balance:', Number(actualABalance.toString()),  ', expected B balance:', theoreticBBalance,', actual B balance:', Number(actualBBalance.toString()));
    }
    for (let step = 0; step < numOrders; step++) {
      actualABalance= Number(await tknA.balanceOf(accounts[numOrders+step]))/Number(precision);
      actualBBalance= Number(await tknB.balanceOf(accounts[numOrders+step]))/Number(precision);
      //not checking properly for imbalance yet
      if (_CP>=blockchainSellOrders[step]._price){
        theoreticABalance= (blockchainSellOrders[step]._size*_CP)/Number(precision);
        theoreticBBalance=(Number(mintSizeB)-blockchainSellOrders[step]._size)/Number(precision);
      } else{
        theoreticABalance=0;
        theoreticBBalance=Number(mintSizeB/precision);
      }
      console.log('Account ', numOrders+step ,'. expected A balance:', theoreticABalance, ', actual A balance:', Number(actualABalance.toString()),  ', expected B balance:', theoreticBBalance,', actual B balance:', Number(actualBBalance.toString()));
    }

  });

});

// clearing price calculator as outlined in the paper.

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
