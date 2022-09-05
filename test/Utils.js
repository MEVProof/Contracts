const circomlib = require('circomlib')
const merkleTree = require('fixed-merkle-tree')
const ffUtils = require('ffjavascript').utils
const leBuff2int = ffUtils.leBuff2int
const stringifyBigInts = ffUtils.stringifyBigInts
const crypto = require('crypto')
const web3 = require('web3')

const { prove } = require('./prover')

const { poseidon } = require('circomlib')

const { assert } = require('chai')

const FIELD_SIZE = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
)

const poseidonHash = (items) => BigInt(poseidon(items).toString())
const poseidonHash2 = (a, b) => poseidonHash([a, b])

/** Generate random number of specified byte length */
const rbigint = nbytes => leBuff2int(crypto.randomBytes(nbytes))

/** Compute pedersen hash */
const pedersenHash = data => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]

/** BigNumber to hex string of specified length */
function toHex(number, length = 32) {
  const str = number instanceof Buffer ? number.toString('hex') : BigInt(number).toString(16)
  return '0x' + str.padStart(length * 2, '0')
}

class Order {
  constructor(isBuyOrder, size, price, maxTradeableWidth, account) {
    this._isBuyOrder = isBuyOrder
    this._size = size
    this._price = price
    this._maxTradeableWidth = maxTradeableWidth
    this._owner = account
  }

  GetSolidityHash() {
    const hash = BigInt(web3.utils.soliditySha3(
      { t: 'bool', v: this._isBuyOrder },
      { t: 'uint256', v: toHex(this._size) },
      { t: 'uint256', v: toHex(this._price) },
      { t: 'uint256', v: toHex(this._maxTradeableWidth) },
      { t: 'address', v: this._owner }))

    const modHash = hash.mod(FIELD_SIZE).toString()
    return modHash
  }

  Unwrap() {
    return {
      _isBuyOrder: this._isBuyOrder ? 1 : 0,
      _size: this._size.toString(),
      _price: this._price.toString(),
      _maxTradeableWidth: this._maxTradeableWidth.toString(),
      _owner: this._owner
    }
  }
}

function OrderFromJSON(asJson) {
  return new Order(asJson._isBuyOrder, asJson._size, asJson._price, asJson._maxTradeableWidth, asJson._owner)
}

class MarketMakerOrder {
  constructor(bidPrice, bidSize, offerPrice, offerSize, owner) {
    this._bidPrice = bidPrice
    this._bidSize = bidSize
    this._offerPrice = offerPrice
    this._offerSize = offerSize
    this._owner = owner
  }

  GetSolidityHash() {
    return web3.utils.soliditySha3(
      { t: 'uint256', v: Number(this._bidPrice) },
      { t: 'uint256', v: Number(this._bidSize) },
      { t: 'uint256', v: Number(this._offerPrice) },
      { t: 'uint256', v: Number(this._offerSize) },
      { t: 'address', v: this._owner })
  }

  Unwrap() {
    return {
      _bidPrice: this._bidPrice.toString(),
      _bidSize: this._bidSize.toString(),
      _offerPrice: this._offerPrice.toString(),
      _offerSize: this._offerSize.toString(),
      _owner: this._owner
    }
  };
}
class Deposit {
  constructor(nullifier, randomness, nextHop = null) {
    this.nullifier = nullifier
    this.randomness = randomness

    this.nullifierHex = toHex(nullifier)
    this.randomnessHex = toHex(randomness)

    this.preimage = Buffer.concat([this.nullifier.leInt2Buff(31), this.randomness.leInt2Buff(31)])

    this.commitment = BigInt(pedersenHash(this.preimage)).mod(FIELD_SIZE).toString()
    this.commitmentHex = toHex(this.commitment)

    this.nullifierHash = BigInt(pedersenHash(this.nullifier.leInt2Buff(31))).mod(FIELD_SIZE).toString()
    this.nullifierHashHex = toHex(this.nullifierHash)

    this.nextHop = nextHop
  }
}

function GenerateDeposit(withNextHop = false) {
  return new Deposit(rbigint(31), rbigint(31), withNextHop ? GenerateDeposit() : null)
}

const MERKLE_TREE_HEIGHT = 20

async function GenerateMerklePath(contract, deposit) {
  // Get all deposit events from smart contract and assemble merkle tree from them
  const events = await contract.getPastEvents('Deposit', { fromBlock: 0, toBlock: 'latest' })
  const leaves = events
    .sort((a, b) => a.returnValues.leafIndex - b.returnValues.leafIndex) // Sort events in chronological order
    .map(e => e.returnValues.commitment)
  const depositEvents = events
    .sort((a, b) => a.returnValues.leafIndex - b.returnValues.leafIndex)
  const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves, { hashFunction: poseidonHash2 })

  // Find current commitment in the tree
  const depositEvent = events.find(e => e.returnValues.commitment === toHex(deposit.commitment))
  const leafIndex = depositEvent ? depositEvent.returnValues.leafIndex : -1
  // Validate that our data is correct
  const root = tree.root()
  const isValidRoot = await contract.methods.isKnownRoot(toHex(root)).call()
  const isSpent = await contract.methods.isSpent(toHex(deposit.nullifierHash)).call()
  assert(isValidRoot === true, 'Merkle tree is corrupted')
  assert(isSpent === false, 'The note is already spent')
  assert(leafIndex >= 0, 'The deposit is not found in the tree')

  // Compute merkle proof of our commitment
  const { pathElements, pathIndices } = tree.path(leafIndex)
  return { pathElements, pathIndices, root: tree.root() }
}

async function GenerateProofOfDeposit(contract, deposit, orderHash, relayerAddress = 0, fee = 1, refund = 1) {
  // Compute merkle proof of our commitment
  const { root, pathElements, pathIndices } = await GenerateMerklePath(contract, deposit)

  // Prepare circuit input
  const input = stringifyBigInts({
    // Public snark inputs
    root: root,
    nullifierHash: deposit.nullifierHash,
    orderHash: BigInt(orderHash),
    relayer: BigInt(relayerAddress),
    fee: BigInt(fee),
    refund: BigInt(refund),

    // Private snark inputs
    nullifier: deposit.nullifier,
    secret: deposit.randomness,
    pathElements: pathElements,
    pathIndices: pathIndices
  })

  const proof = await prove(input, './artifacts/circuits/provideEscrow')

  const args = [
    toHex(input.root),
    toHex(input.nullifierHash),
    toHex(input.orderHash),
    toHex(input.relayer, 20),
    toHex(input.fee),
    toHex(input.refund)
  ]

  return { proof, args }
}

function CalculateClearingPrice(buyOrders, sellOrders, minTickSize) {
  const numBuys = buyOrders.length
  const numSells = sellOrders.length

  let prices = []

  for (let step = 0; step < numBuys; step++) {
    if (prices.indexOf(buyOrders[step].price) === -1) {
      prices.push(buyOrders[step].price)
    }
  }

  for (let step = 0; step < numSells; step++) {
    if (prices.indexOf(sellOrders[step].price) === -1) {
      prices.push(sellOrders[step].price)
    }
  }
  
  // console.log('check1:', _prices);
  prices = prices.sort(function (a, b) { return a - b })
  // console.log('check2:', _prices);


  const numPricePoints = prices.length
  const buyVolumes = []
  const sellVolumes = []
  const imbalances = []

  for (let step = 0; step < numBuys; step++) {
    buyVolumes[buyOrders[step].price] = (buyVolumes[buyOrders[step].price] || 0) + buyOrders[step].size
  }
  for (let step = 0; step < numSells; step++) {
    sellVolumes[sellOrders[step].price] = (sellVolumes[sellOrders[step].price] || 0) + sellOrders[step].size
  }
  // console.log('check3.1:', _buyVolumes);
  // console.log('check3.2:', _sellVolumes);
  for (let step = 0; step < numPricePoints - 1; step++) {
    buyVolumes[prices[(numPricePoints - 2) - step]] = (buyVolumes[prices[(numPricePoints - 2) - step]] || 0) + (buyVolumes[prices[(numPricePoints - 1) - step]] || 0)
    sellVolumes[prices[1 + step]] = (sellVolumes[prices[1 + step]] || 0) + (sellVolumes[prices[step]] || 0)
  }

  const _clearingVolumes = []
  for (let step = 0; step < numPricePoints; step++) {
    _clearingVolumes[prices[step]] = Math.min((buyVolumes[prices[step]] || 0), (sellVolumes[prices[step]] || 0) * prices[step])
  }
  // console.log('check4:', _clearingVolumes);
  let maxVolume = 0
  let clearingPrice = -1
  for (let step = 0; step < numPricePoints; step++) {
    if (_clearingVolumes[prices[step]] > maxVolume) {
      maxVolume = _clearingVolumes[prices[step]]
      clearingPrice = prices[step]
    }
  }
  // console.log('check4.1:', _maxVolume);
  for (let step = 0; step < numPricePoints; step++) {
    imbalances[prices[step]] = buyVolumes[prices[step]] - (sellVolumes[prices[step]] * prices[step])
  }

  // console.log('check4.2:', _clearingVolumes.indexOf(_maxVolume));
  let imbalanceAtClearingPrice = imbalances[clearingPrice]
  // console.log('check5:', _clearingPrice, _imbalance);
  let buyVolumeFinal = 0
  let sellVolumeFinal = 0

  if (imbalanceAtClearingPrice > 0) {
    for (let step = 0; step < numBuys; step++) {
      if (buyOrders[step].price > clearingPrice) {
        buyVolumeFinal += buyOrders[step].size
      }
    }

    for (let step = 0; step < numSells; step++) {
      if (sellOrders[step].price <= clearingPrice) {
        sellVolumeFinal += sellOrders[step].size
      }
    }

    const upperbound = prices[prices.indexOf(clearingPrice) + 1]
    let newImbalance = buyVolumeFinal - (sellVolumeFinal * (clearingPrice + minTickSize))

    while (maxVolume === Math.min(buyVolumeFinal, sellVolumeFinal * (clearingPrice + minTickSize)) && Math.abs(newImbalance) < Math.abs(imbalanceAtClearingPrice) && clearingPrice + minTickSize < upperbound) {
      clearingPrice += minTickSize
      imbalanceAtClearingPrice = newImbalance
      newImbalance = buyVolumeFinal - (sellVolumeFinal * (clearingPrice + minTickSize))
    }
  } else {
    for (let step = 0; step < numBuys; step++) {
      if (buyOrders[step].price >= clearingPrice) {
        buyVolumeFinal += buyOrders[step].size
      }
    }

    for (let step = 0; step < numSells; step++) {
      if (sellOrders[step].price < clearingPrice) {
        sellVolumeFinal += sellOrders[step].size
      }
    }

    const lowerbound = prices[prices.indexOf(clearingPrice) - 1]    
    let newImbalance = buyVolumeFinal - (sellVolumeFinal * (clearingPrice - minTickSize))
    
    while (maxVolume === Math.min(buyVolumeFinal, sellVolumeFinal * (clearingPrice - minTickSize)) && Math.abs(newImbalance) < Math.abs(imbalanceAtClearingPrice) && clearingPrice - minTickSize > lowerbound) {
      clearingPrice -= minTickSize
      imbalanceAtClearingPrice = newImbalance
      newImbalance = buyVolumeFinal - (sellVolumeFinal * (clearingPrice - minTickSize))
    }
  }

  return {
    clearingPrice: clearingPrice,
    volumeSettled: maxVolume,
    imbalance: imbalanceAtClearingPrice
  }
}

async function GetOpenOrders(contract, precision) {
  const numBlockchainBuys = await contract.methods._getNumBuyOrders().call()
  const numBlockchainSells = await contract.methods._getNumSellOrders().call()
  const wTight = Number(await contract.methods._getWidthTight().call())

  let blockchainBuyOrders = []
  let blockchainSellOrders = []

  for (let step = 0; step < numBlockchainBuys; step++) {
    const buyOrder = await contract.methods._revealedBuyOrders(step).call()

    const w = Number(buyOrder._maxTradeableWidth)

    if (w >= wTight) {
      const p = buyOrder._price
      const s = buyOrder._size

      blockchainBuyOrders.push({
        price: Number(p.toString()) / Number(precision),
        size: Number(s.toString()) / Number(precision),
        owner: buyOrder._owner
      })
    }
  }

  for (let step = 0; step < numBlockchainSells; step++) {
    const sellOrder = await contract.methods._revealedSellOrders(step).call()

    const w = Number(sellOrder._maxTradeableWidth)

    if (w >= wTight) {
      const p = sellOrder._price
      const s = sellOrder._size

      blockchainSellOrders.push({
        price: Number(p.toString()) / Number(precision),
        size: Number(s.toString()) / Number(precision),
        owner: sellOrder._owner
      })
    }
  }

  return {
    blockchainBuyOrders: blockchainBuyOrders,
    blockchainSellOrders: blockchainSellOrders
  }
}

exports.Order = Order
exports.MarketMakerOrder = MarketMakerOrder
exports.Deposit = Deposit
exports.GenerateDeposit = GenerateDeposit
exports.GenerateProofOfDeposit = GenerateProofOfDeposit
exports.toHex = toHex
exports.OrderFromJSON = OrderFromJSON
exports.CalculateClearingPrice = CalculateClearingPrice
exports.GetOpenOrders = GetOpenOrders
