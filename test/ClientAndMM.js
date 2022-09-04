const BN = require('bn.js')
const chai = require('chai')
const chaiBn = require('chai-bn')
chai.use(chaiBn(BN))

// setting seed equal to a constant generates predicatable randomness
// so we can repeat tests if/ when they fail
let seed = 1

function random () {
  const x = Math.sin(seed++) * 10000
  return x - Math.floor(x)
}

const CnM = artifacts.require('ClientAndMM')
const TokenA = artifacts.require('TokenA')
const TokenB = artifacts.require('TokenB')

// these variables are used only to generate orders, and not "accessible" by the contracts/ CP calculator
// decimalPoints specifies the price precision, and
// the precision to which orders are being settled correctly

const decimalPoints = 10
const precision = BigInt(Math.pow(10, decimalPoints))
const localFairPrice = BigInt(100)
const fairPrice = localFairPrice * precision


  // 2*numOrders +numMarkets must be at most the number of accounts. There are only 10 accounts in truffle by default. Running yarn ganache -a X creates X accounts
  const numOrders = 4
  const numMarkets = 2
  const marketWidths = BigInt(Math.floor(0.05 * Number(fairPrice)))
  const orderSize = BigInt(1000)

const Utils = require('./Utils')

// all numbers are converted to BigInt so they can be passed to Solidity
function generateBuyOrders (accounts) {
  const buyOrders = []
  for (let step = 0; step < numOrders; step++) {
    buyOrders.push(new Utils.Order(true,
      BigInt(Math.floor(random() * Number(orderSize))) * localFairPrice * precision,
      BigInt(Math.floor(random() * Number(localFairPrice) * 3)) * precision,
      marketWidths,
      accounts[step]
    ))
  }
  return buyOrders
}

function generateSellOrders (accounts) {
  const sellOrders = []
  for (let step = numOrders; step < 2 * numOrders; step++) {
    sellOrders.push(new Utils.Order(false,
      BigInt(Math.floor(random() * Number(orderSize))) * precision,
      BigInt(Math.floor(random() * Number(localFairPrice))) * precision,
      marketWidths,
      accounts[step]
    ))
  }
  return sellOrders
}

function generateDeposits () {
  const deposits = []
  for (let step = 0; step < numOrders; step++) {
    deposits.push(Utils.GenerateDeposit(withNextHop = true))
  }
  return deposits
}

function generateMarkets (accounts) {
  const markets = []
  for (let step = 2 * numOrders; step < (2 * numOrders) + numMarkets; step++) {
    const mids = fairPrice + BigInt(Math.floor(random() * Number(marketWidths) * 2)) - marketWidths
    const _market = new Utils.MarketMakerOrder(mids - BigInt(Math.floor(Number(marketWidths) / 2)),
      BigInt(Math.floor(random() * Number(orderSize))) * localFairPrice * precision,
      mids + BigInt(Math.floor(Number(marketWidths) / 2)),
      BigInt(Math.floor(random() * Number(localFairPrice))) * precision,

      accounts[step])
    markets.push(_market)
  }
  return markets
}

contract('ClientAndMM', async function (accounts) {
  const oneEth = 1
  const tenEth = 10
  const clientDepositAmount = 3
  let inst
  let reg

  let tknA
  let tknB

  let blockchainBuyOrders = []
  let blockchainSellOrders = []
  let clearingInfo

  // specifies amount of each token to mint/apporve for each player
  const mintSizeA = BigInt(orderSize * orderSize * localFairPrice * precision)
  const mintSizeB = BigInt(orderSize * orderSize * precision)

  const buyOrders = generateBuyOrders(accounts)
  const sellOrders = generateSellOrders(accounts)
  const buyOrderDeposits = generateDeposits()
  const sellOrderDeposits = generateDeposits()
  const markets = generateMarkets(accounts)

  it('should be deployed', async function () {
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
  
  it('should initialise auction', async function () {
    await inst.Move_To_Commit_Phase()
  })
 

  it('should defer register properly', async function () {
    for (let step = 0; step < numOrders; step++) {
      await inst.Client_Register_Deferred(buyOrderDeposits[step].commitmentHex, { from: accounts[step], value: clientDepositAmount+1})
      await inst.Client_Register_Deferred(sellOrderDeposits[step].commitmentHex, { from: accounts[numOrders + step], value: clientDepositAmount+1 })
    }
  })
  
  it('should batch IDs properly', async function () {
    await inst.Batch_Add_IDs({ from: accounts[0]})
  })
 
  it('should add client commitments', async function () {
    for (let step = 0; step < numOrders; step++) {
      const buyProof = await Utils.GenerateProofOfDeposit(inst.contract, buyOrderDeposits[step], buyOrders[step].GetSolidityHash())
      const sellProof = await Utils.GenerateProofOfDeposit(inst.contract, sellOrderDeposits[step], sellOrders[step].GetSolidityHash())

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
      await inst.Client_Reveal(Utils.toHex(buyOrders[step].GetSolidityHash()), buyOrders[step].Unwrap(), buyOrderDeposits[step].nullifierHex, buyOrderDeposits[step].randomnessHex, buyOrderDeposits[step].commitmentHex, buyOrderDeposits[step].nextHop.commitmentHex, { from: accounts[step], value: oneEth })
      await inst.Client_Reveal(Utils.toHex(sellOrders[step].GetSolidityHash()), sellOrders[step].Unwrap(), sellOrderDeposits[step].nullifierHex, sellOrderDeposits[step].randomnessHex, sellOrderDeposits[step].commitmentHex, sellOrderDeposits[step].nextHop.commitmentHex, { from: accounts[numOrders + step], value: oneEth })
    }
  })

  it('should reveal MMs', async function () {
    for (let step = 0; step < numMarkets; step++) {
      await inst.MM_Reveal(markets[step].GetSolidityHash(), markets[step], { from: accounts[(2 * numOrders) + step] })
    }
  })

  // downloads order information from blockchain, and calculates clearing price locally
  // by calling getClearingPrice()
  it('get Clearing Price Info', async function () {
    const orders = await Utils.GetOpenOrders(inst)

    blockchainBuyOrders = orders.blockchainBuyOrders
    blockchainSellOrders = orders.blockchainSellOrders

    console.log('blockchain buy orders:', blockchainBuyOrders)
    console.log('blockchain sell orders:', blockchainSellOrders)

    for (let step = 0; step < blockchainBuyOrders.length; step++) {
      blockchainBuyOrders[step]._size = blockchainBuyOrders[step]._size * Number(precision)
    }

    for (let step = 0; step < blockchainSellOrders.length; step++) {
      blockchainSellOrders[step]._size = blockchainSellOrders[step]._size * Number(precision)
    }
  })

  // due to rounding errors, buyVol, sellVol, CP and imbalance are improbable to match on chain
  // this function uses the correctly computed clearing price to back out these values
  // as Solidity does. It is currently an on-chain computation, but running Solidity locally
  // would suffice.
  it('convert clearing price info to satisfy on-chain requirements', async function () {
    const minTickSize = Number(await inst._getMinTickSize()) / Number(precision)

    clearingInfo = Utils.CalculateClearingPrice(blockchainBuyOrders, blockchainSellOrders, minTickSize)
    clearingInfo.clearingPrice = BigInt(Math.round(Number(clearingInfo.clearingPrice) * Number(precision)))

    await inst.clearingPriceConvertor(clearingInfo.clearingPrice, BigInt(Math.floor(Number(clearingInfo.volumeSettled))), BigInt(Math.floor(Number(clearingInfo.imbalance))), { from: accounts[0], gasLimit: 10000000 })
    
    clearingInfo.volumeSettled = BigInt(Number(await inst._getSolVolumeSettled()))
    clearingInfo.imbalance = BigInt(Number(await inst._getSolImbalance()))
    
    console.log('clearing price:', Number(clearingInfo.clearingPrice) / Number(precision), ', volume settled in token A:', Number(clearingInfo.volumeSettled) / Number(precision), ', imbalance:', Number(clearingInfo.imbalance) / Number(precision))
  })

  it('should settle orders', async function () {
    reg = await inst.Settlement(clearingInfo.clearingPrice, clearingInfo.volumeSettled, clearingInfo.imbalance, { from: accounts[0], gasLimit: 10000000, value: oneEth })
  })

  // a checker function to ensure settlement is done as expected.
  it('check client order settlement', async function () {
    let theoreticABalance
    let theoreticBBalance
    let actualABalance
    let actualBBalance
    const _CP = Number(clearingInfo.clearingPrice) / Number(precision)
    for (let step = 0; step < numOrders; step++) {
      actualABalance = Number(await tknA.balanceOf(accounts[step])) / Number(precision)
      actualBBalance = Number(await tknB.balanceOf(accounts[step])) / Number(precision)
      // not checking properly for imbalance yet
      if (_CP < blockchainBuyOrders[step]._price) {
        theoreticABalance = (Number(mintSizeA) - blockchainBuyOrders[step]._size) / Number(precision)
        theoreticBBalance = (Number(blockchainBuyOrders[step]._size) / _CP) / Number(precision)
      } else {
        theoreticABalance = Number(mintSizeA / precision)
        theoreticBBalance = 0
      }

      console.log('Account ', step, '. expected A balance:', theoreticABalance, ', actual A balance:', Number(actualABalance.toString()), ', expected B balance:', theoreticBBalance, ', actual B balance:', Number(actualBBalance.toString()))
    }
    for (let step = 0; step < numOrders; step++) {
      actualABalance = Number(await tknA.balanceOf(accounts[numOrders + step])) / Number(precision)
      actualBBalance = Number(await tknB.balanceOf(accounts[numOrders + step])) / Number(precision)
      // not checking properly for imbalance yet
      if (_CP >= blockchainSellOrders[step]._price) {
        theoreticABalance = (blockchainSellOrders[step]._size * _CP) / Number(precision)
        theoreticBBalance = (Number(mintSizeB) - blockchainSellOrders[step]._size) / Number(precision)
      } else {
        theoreticABalance = 0
        theoreticBBalance = Number(mintSizeB / precision)
      }
      console.log('Account ', numOrders + step, '. expected A balance:', theoreticABalance, ', actual A balance:', Number(actualABalance.toString()), ', expected B balance:', theoreticBBalance, ', actual B balance:', Number(actualBBalance.toString()))
    }
  })
})