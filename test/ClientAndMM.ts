import { ClientAndMMInstance, TokenAInstance, TokenBInstance } from "../types/truffle-contracts"

import BN from 'bn.js'
const chai = require('chai')
const chaiBn = require('chai-bn')
chai.use(chaiBn(BN))

// setting seed equal to a constant generates predicatable randomness
// so we can repeat tests if/ when they fail
let seed = Math.random()

function random () : number {
  const x = Math.sin(seed++) * 10000
  return (x - Math.floor(x))
}

function randomRange(x : BN) : BN {
  return x.muln(random())
}

const CnM = artifacts.require('ClientAndMM')
const TokenA = artifacts.require('TokenA')
const TokenB = artifacts.require('TokenB')

// these variables are used only to generate orders, and not "accessible" by the contracts/ CP calculator
// decimalPoints specifies the price precision, and
// the precision to which orders are being settled correctly

const decimalPoints = new BN(10)
const precision = new BN(10).pow(decimalPoints);
const localFairPrice = new BN(100)
const fairPrice : BN = localFairPrice.mul(precision)

// 2*numOrders +numMarkets must be at most 10 as there are only 10 accounts in truffle
const numOrders = 4
const numMarkets = 2
const marketWidths = fairPrice.muln(0.05)
const orderSize = new BN(1000)

import { Deposit, Order, MarketMakerOrder, GenerateDeposit, GenerateProofOfDeposit, toHex } from './Utils'

// all numbers are converted to BigInt so they can be passed to Solidity
function generateBuyOrders (accounts : string[]) {
  const buyOrders = []
  
  for (let step = 0; step < numOrders; step++) {
    buyOrders.push(new Order(true,
      randomRange(orderSize).mul(localFairPrice).mul(precision),
      randomRange(localFairPrice.mul(new BN(3))).mul(precision),
      marketWidths,
      accounts[step]
    ))
  }

  return buyOrders
}

function generateSellOrders (accounts : string[]) {
  const sellOrders = []
  for (let step = numOrders; step < 2 * numOrders; step++) {
    sellOrders.push(new Order(false,
      randomRange(orderSize).mul(precision),
      randomRange(localFairPrice).mul(precision),
      marketWidths,
      accounts[step]
    ))
  }
  return sellOrders
}

function generateDeposits () : Deposit[] {
  const deposits = []
  for (let step = 0; step < numOrders; step++) {
    deposits.push(GenerateDeposit(true))
  }
  return deposits
}

function generateMarkets (accounts : string[]) {
  const markets = []
  for (let step = 2 * numOrders; step < (2 * numOrders) + numMarkets; step++) {
    const mids = fairPrice.add(randomRange(marketWidths.muln(2))).sub(marketWidths)

    const _market = new MarketMakerOrder(
      mids.sub(marketWidths.divn(2)),
      randomRange(orderSize).mul(localFairPrice).mul(precision),
      mids.add(marketWidths.divn(2)),
      randomRange(localFairPrice).mul(precision),
      accounts[step])

    markets.push(_market)
  }
  return markets
}

interface ClearingOrder {
  _price : BN;
  _size : BN;
}

contract('ClientAndMM', async function (accounts) {
  const oneEth = new BN(1)
  const tenEth = new BN(10)
  const clientDepositAmount = new BN(3) 
  let inst: ClientAndMMInstance
  let reg

  let tknA: TokenAInstance
  let tknB: TokenBInstance
  let minTickSize: BN
  let wTight
  let numBlockchainBuys
  let numBlockchainSells
  const blockchainBuyOrders: ClearingOrder[] = []
  const blockchainSellOrders: ClearingOrder[] = []
  let clearingInfo: { clearingPrice: BN; volumeSettled: BN; imbalance: BN }

  // specifies amount of each token to mint/apporve for each player
  const mintSizeA = orderSize.mul(orderSize).mul(localFairPrice).mul(precision)
  const mintSizeB = orderSize.mul(orderSize).mul(precision)

  const buyOrders = generateBuyOrders(accounts)
  const sellOrders = generateSellOrders(accounts)
  const buyOrderDeposits = generateDeposits()
  const sellOrderDeposits = generateDeposits()
  const markets = generateMarkets(accounts)

  it('should be deployed', async function () {

    // let dep2 = new Deposit(new BN('347772766944456609595462652943381358370428882929125393768635904846074729881'), new BN('54151491953919259039613378184998532666524616412577698393763023798519349167'))
    // console.log(dep2)

    inst = await CnM.deployed()
    tknA = await TokenA.deployed()
    tknB = await TokenB.deployed()
  })

  it('mint and approve tokens', async function () {
    for (let step = 0; step < numOrders; step++) {
      await tknA.mint(accounts[step], mintSizeA)
      await tknB.mint(accounts[numOrders + step], mintSizeB)
      await tknA.approve(inst.address, mintSizeA, { from: accounts[step] })
      await tknB.approve(inst.address, mintSizeB, { from: accounts[numOrders + step] })
    }
    for (let step = 0; step < numMarkets; step++) {
      await tknA.mint(accounts[(2 * numOrders) + step], mintSizeA)
      await tknB.mint(accounts[(2 * numOrders) + step], mintSizeB)
      await tknA.approve(inst.address, mintSizeA, { from: accounts[(2 * numOrders) + step] })
      await tknB.approve(inst.address, mintSizeB, { from: accounts[(2 * numOrders) + step] })
    }
  })

  it('should register properly', async function () {
    for (let step = 0; step < numOrders; step++) {
      await inst.Client_Register(buyOrderDeposits[step].commitmentHex, { from: accounts[step], value: clientDepositAmount })
      await inst.Client_Register(sellOrderDeposits[step].commitmentHex, { from: accounts[numOrders + step], value: clientDepositAmount })
    }
  })

  it('should add client commitments', async function () {
    for (let step = 0; step < numOrders; step++) {
      const buyProof = await GenerateProofOfDeposit(inst, buyOrderDeposits[step], buyOrders[step].GetSolidityHash())
      const sellProof = await GenerateProofOfDeposit(inst, sellOrderDeposits[step], sellOrders[step].GetSolidityHash())

      await inst.Client_Commit(buyProof.proof, ...buyProof.args, { from: accounts[step] })
      await inst.Client_Commit(sellProof.proof, ...sellProof.args, { from: accounts[step] })
    }
  })

  it('should add MM commitments', async function () {
    for (let step = 0; step < numMarkets; step++) {
      await inst.MM_Commit(markets[step].GetSolidityHash(), { from: accounts[(2 * numOrders) + step], value: tenEth })
    }
  })

  it('should move to Reveal phase', async function () {
    reg = await inst.Move_To_Reveal_Phase()
  })

  it('should reveal clients', async function () {
    for (let step = 0; step < numOrders; step++) {
      await inst.Client_Reveal(toHex(buyOrders[step].GetSolidityHash()), buyOrders[step].Unwrap(), buyOrderDeposits[step].nullifierHex, buyOrderDeposits[step].randomnessHex, buyOrderDeposits[step].commitmentHex, buyOrderDeposits[step].nextHop!.commitmentHex, { from: accounts[step], value: oneEth })
      await inst.Client_Reveal(toHex(sellOrders[step].GetSolidityHash()), sellOrders[step].Unwrap(), sellOrderDeposits[step].nullifierHex, sellOrderDeposits[step].randomnessHex, sellOrderDeposits[step].commitmentHex, sellOrderDeposits[step].nextHop!.commitmentHex, { from: accounts[numOrders + step], value: oneEth })
    }
  })

  it('should reveal MMs', async function () {
    for (let step = 0; step < numMarkets; step++) {
      await inst.MM_Reveal(markets[step].GetSolidityHash(), markets[step].Unwrap(), { from: accounts[(2 * numOrders) + step] })
    }
  })

  // downloads order information from blockchain, and calculates clearing price locally
  // by calling getClearingPrice()
  it('get Clearing Price Info', async function () {
    minTickSize = (await inst._getMinTickSize()).div(precision)
    numBlockchainBuys = await inst._getNumBuyOrders()
    numBlockchainSells = await inst._getNumSellOrders()
    wTight = await inst._getWidthTight()

    // Can safely assume we won't need more than 53 bits to count the number of orders
    for (let step = 0; step < numBlockchainBuys.toNumber(); step++) {
      const receivedBuyOrder = await inst._revealedBuyOrders(step)
      const buyOrder = new Order(receivedBuyOrder[0], receivedBuyOrder[1], receivedBuyOrder[2], receivedBuyOrder[3], receivedBuyOrder[4]);

      const w = buyOrder._maxTradeableWidth

      if (w.gte(wTight)) {
        const p = buyOrder._price
        const s = buyOrder._size

        blockchainBuyOrders.push({
          _price: p.div(precision),
          _size: s.div(precision)
        })
      }
    }

    for (let step = 0; step < numBlockchainSells.toNumber(); step++) {
      const receivedSellOrder = await inst._revealedSellOrders(step)
      const sellOrder = new Order(receivedSellOrder[0], receivedSellOrder[1], receivedSellOrder[2], receivedSellOrder[3], receivedSellOrder[4]);

      const w = sellOrder._maxTradeableWidth

      if (w.gte(wTight)) {
        const p = sellOrder._price
        const s = sellOrder._size

        blockchainSellOrders.push({
          _price: p.div(precision),
          _size: s.div(precision)
        })
      }
    }

    console.log('blockchain buy orders:', blockchainBuyOrders)
    console.log('blockchain sell orders:', blockchainSellOrders)

    for (let step = 0; step < blockchainBuyOrders.length; step++) {
      blockchainBuyOrders[step]._size = blockchainBuyOrders[step]._size.mul(precision)
    }

    for (let step = 0; step < blockchainSellOrders.length; step++) {
      blockchainSellOrders[step]._size = blockchainSellOrders[step]._size.mul(precision)
    }
  })

  // due to rounding errors, buyVol, sellVol, CP and imbalance are improbable to match on chain
  // this function uses the correctly computed clearing price to back out these values
  // as Solidity does. It is currently an on-chain computation, but running Solidity locally
  // would suffice.
  it('convert clearing price info to satisfy on-chain requirements', async function () {
    clearingInfo = getClearingPrice(blockchainBuyOrders, blockchainSellOrders, minTickSize)
    clearingInfo.clearingPrice = clearingInfo.clearingPrice.mul(precision)

    await inst.clearingPriceConvertor(clearingInfo.clearingPrice, clearingInfo.volumeSettled, clearingInfo.imbalance, { from: accounts[0], gas: 10000000 })

    clearingInfo.volumeSettled = await inst._getSolVolumeSettled()
    clearingInfo.imbalance = await inst._getSolImbalance()

    console.log('clearing price:', clearingInfo.clearingPrice.div(precision).toString(), ', volume settled in token A:', clearingInfo.volumeSettled.div(precision).toString(), ', imbalance:', clearingInfo.imbalance.div(precision).toString())
  })

  it('should settle orders', async function () {
    reg = await inst.Settlement(clearingInfo.clearingPrice, clearingInfo.volumeSettled, clearingInfo.imbalance, { from: accounts[0], gas: 10000000, value: oneEth })
  })

  // a checker function to ensure settlement is done as expected.
  it('check client order settlement', async function () {
    let theoreticABalance
    let theoreticBBalance
    let actualABalance
    let actualBBalance

    const _CP = clearingInfo.clearingPrice.div(precision)
    
    for (let step = 0; step < numOrders; step++) {
      actualABalance = (await tknA.balanceOf(accounts[step])).div(precision)
      actualBBalance = (await tknB.balanceOf(accounts[step])).div(precision)

      // not checking properly for imbalance yet
      if (_CP < blockchainBuyOrders[step]._price) {
        theoreticABalance = mintSizeA.sub(blockchainBuyOrders[step]._size).div(precision)
        theoreticBBalance = blockchainBuyOrders[step]._size.div(_CP).div(precision)
      } else {
        theoreticABalance = mintSizeA.div(precision)
        theoreticBBalance = new BN(0)
      }

      console.log('Account ', step, '. expected A balance:', theoreticABalance.toString(), ', actual A balance:', actualABalance.toString(), ', expected B balance:', theoreticBBalance, ', actual B balance:', actualBBalance.toString())
    }

    for (let step = 0; step < numOrders; step++) {
      actualABalance = (await tknA.balanceOf(accounts[numOrders + step])).div(precision)
      actualBBalance = (await tknB.balanceOf(accounts[numOrders + step])).div(precision)

      // not checking properly for imbalance yet
      if (_CP >= blockchainSellOrders[step]._price) {
        theoreticABalance = blockchainSellOrders[step]._size.mul(_CP).div(precision)
        theoreticBBalance = mintSizeB.sub(blockchainSellOrders[step]._size).div(precision)
      } else {
        theoreticABalance = 0
        theoreticBBalance = mintSizeB.div(precision)
      }
      console.log('Account ', numOrders + step, '. expected A balance:', theoreticABalance.toString(), ', actual A balance:', actualABalance.toString(), ', expected B balance:', theoreticBBalance, ', actual B balance:', actualBBalance.toString())
    }
  })
})

function getClearingPrice (buyOrders: ClearingOrder[], sellOrders: ClearingOrder[], minTickSize: BN) {
  // const _numBuys = buyOrders.length
  // const _numSells = sellOrders.length
  // let _prices = []

  // for (let step = 0; step < _numBuys; step++) {
  //   if (_prices.indexOf(buyOrders[step]._price) === -1) {
  //     _prices.push(buyOrders[step]._price)
  //   }
  // }
  // for (let step = 0; step < _numSells; step++) {
  //   if (_prices.indexOf(sellOrders[step]._price) === -1) {
  //     _prices.push(sellOrders[step]._price)
  //   }
  // }
  // // console.log('check1:', _prices);
  // _prices = _prices.sort(function (a, b) { return a.sub(b).toNumber() }) // TODO: Does this work?
  // // console.log('check2:', _prices);
  // const _numPricePoints = _prices.length
  // const _buyVolumes : BN[] = []
  // const _sellVolumes : BN[] = []

  // for (let step = 0; step < _numBuys; step++) {
  //   _buyVolumes[buyOrders[step]._price] = (_buyVolumes[buyOrders[step]._price] || 0) + buyOrders[step]._size
  // }
  // for (let step = 0; step < _numSells; step++) {
  //   _sellVolumes[sellOrders[step]._price] = (_sellVolumes[sellOrders[step]._price] || 0) + sellOrders[step]._size
  // }

  // // console.log('check3.1:', _buyVolumes);
  // // console.log('check3.2:', _sellVolumes);
  // for (let step = 0; step < _numPricePoints - 1; step++) {
  //   _buyVolumes[_prices[(_numPricePoints - 2) - step]] = (_buyVolumes[_prices[(_numPricePoints - 2) - step]] || 0) + (_buyVolumes[_prices[(_numPricePoints - 1) - step]] || 0)
  //   _sellVolumes[_prices[1 + step]] = (_sellVolumes[_prices[1 + step]] || 0) + (_sellVolumes[_prices[step]] || 0)
  // }

  // const _clearingVolumes = []
  // for (let step = 0; step < _numPricePoints; step++) {
  //   _clearingVolumes[_prices[step]] = Math.min((_buyVolumes[_prices[step]] || 0), (_sellVolumes[_prices[step]] || 0) * _prices[step])
  // }

  // // console.log('check4:', _clearingVolumes);
  // let _maxVolume = 0
  // let _clearingPrice = -1
  // for (let step = 0; step < _numPricePoints; step++) {
  //   if (_clearingVolumes[_prices[step]] > _maxVolume) {
  //     _maxVolume = _clearingVolumes[_prices[step]]
  //     _clearingPrice = _prices[step]
  //   }
  // }

  // // console.log('check4.1:', _maxVolume);
  // const _imbalances = []
  // for (let step = 0; step < _numPricePoints; step++) {
  //   _imbalances[_prices[step]] = _buyVolumes[_prices[step]] - (_sellVolumes[_prices[step]] * _prices[step])
  // }

  // // console.log('check4.2:', _clearingVolumes.indexOf(_maxVolume));
  // let _imbalance = _imbalances[_clearingPrice]
  // // console.log('check5:', _clearingPrice, _imbalance);
  // let _buyVolumeFinal = 0
  // let _sellVolumeFinal = 0

  // if (_imbalance > 0) {
  //   for (let step = 0; step < _numBuys; step++) {
  //     if (buyOrders[step]._price > _clearingPrice) {
  //       _buyVolumeFinal += buyOrders[step]._size
  //     }
  //   }
  //   for (let step = 0; step < _numSells; step++) {
  //     if (sellOrders[step]._price <= _clearingPrice) {
  //       _sellVolumeFinal += sellOrders[step]._size
  //     }
  //   }
  //   const _upperbound = _prices[_prices.indexOf(_clearingPrice) + 1]
  //   let _newImbalance = _buyVolumeFinal - (_sellVolumeFinal * (_clearingPrice + minTickSize))
  //   while (_maxVolume === Math.min(_buyVolumeFinal, _sellVolumeFinal * (_clearingPrice + minTickSize)) && Math.abs(_newImbalance) < Math.abs(_imbalance) && _clearingPrice + minTickSize < _upperbound) {
  //     _clearingPrice += minTickSize
  //     _imbalance = _newImbalance
  //     _newImbalance = _buyVolumeFinal - (_sellVolumeFinal * (_clearingPrice + minTickSize))
  //   }
  // } else {
  //   for (let step = 0; step < _numBuys; step++) {
  //     if (buyOrders[step]._price >= _clearingPrice) {
  //       _buyVolumeFinal += buyOrders[step]._size
  //     }
  //   }
  //   for (let step = 0; step < _numSells; step++) {
  //     if (sellOrders[step]._price < _clearingPrice) {
  //       _sellVolumeFinal += sellOrders[step]._size
  //     }
  //   }
  //   const _lowerbound = _prices[_prices.indexOf(_clearingPrice) - 1]
  //   let _newImbalance = _buyVolumeFinal - (_sellVolumeFinal * (_clearingPrice - minTickSize))
  //   while (_maxVolume === Math.min(_buyVolumeFinal, _sellVolumeFinal * (_clearingPrice - minTickSize)) && Math.abs(_newImbalance) < Math.abs(_imbalance) && _clearingPrice - minTickSize > _lowerbound) {
  //     _clearingPrice -= minTickSize
  //     _imbalance = _newImbalance
  //     _newImbalance = _buyVolumeFinal - (_sellVolumeFinal * (_clearingPrice - minTickSize))
  //   }
  // }

  let _clearingPrice = 0;
  let _maxVolume = 0;
  let _imbalance = 0;

  return {
    clearingPrice: new BN(_clearingPrice),
    volumeSettled: new BN(_maxVolume),
    imbalance: new BN(_imbalance)
  }
}
