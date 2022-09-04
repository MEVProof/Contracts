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
  const _numBuys = buyOrders.length
  const _numSells = sellOrders.length
  let _prices = []

  for (let step = 0; step < _numBuys; step++) {
    if (_prices.indexOf(buyOrders[step]._price) === -1) {
      _prices.push(buyOrders[step]._price)
    }
  }
  for (let step = 0; step < _numSells; step++) {
    if (_prices.indexOf(sellOrders[step]._price) === -1) {
      _prices.push(sellOrders[step]._price)
    }
  }
  // console.log('check1:', _prices);
  _prices = _prices.sort(function (a, b) { return a - b })
  // console.log('check2:', _prices);
  const _numPricePoints = _prices.length
  const _buyVolumes = []
  const _sellVolumes = []
  for (let step = 0; step < _numBuys; step++) {
    _buyVolumes[buyOrders[step]._price] = (_buyVolumes[buyOrders[step]._price] || 0) + buyOrders[step]._size
  }
  for (let step = 0; step < _numSells; step++) {
    _sellVolumes[sellOrders[step]._price] = (_sellVolumes[sellOrders[step]._price] || 0) + sellOrders[step]._size
  }
  // console.log('check3.1:', _buyVolumes);
  // console.log('check3.2:', _sellVolumes);
  for (let step = 0; step < _numPricePoints - 1; step++) {
    _buyVolumes[_prices[(_numPricePoints - 2) - step]] = (_buyVolumes[_prices[(_numPricePoints - 2) - step]] || 0) + (_buyVolumes[_prices[(_numPricePoints - 1) - step]] || 0)
    _sellVolumes[_prices[1 + step]] = (_sellVolumes[_prices[1 + step]] || 0) + (_sellVolumes[_prices[step]] || 0)
  }

  const _clearingVolumes = []
  for (let step = 0; step < _numPricePoints; step++) {
    _clearingVolumes[_prices[step]] = Math.min((_buyVolumes[_prices[step]] || 0), (_sellVolumes[_prices[step]] || 0) * _prices[step])
  }
  // console.log('check4:', _clearingVolumes);
  let _maxVolume = 0
  let _clearingPrice = -1
  for (let step = 0; step < _numPricePoints; step++) {
    if (_clearingVolumes[_prices[step]] > _maxVolume) {
      _maxVolume = _clearingVolumes[_prices[step]]
      _clearingPrice = _prices[step]
    }
  }
  // console.log('check4.1:', _maxVolume);
  const _imbalances = []
  for (let step = 0; step < _numPricePoints; step++) {
    _imbalances[_prices[step]] = _buyVolumes[_prices[step]] - (_sellVolumes[_prices[step]] * _prices[step])
  }

  // console.log('check4.2:', _clearingVolumes.indexOf(_maxVolume));
  let _imbalance = _imbalances[_clearingPrice]
  // console.log('check5:', _clearingPrice, _imbalance);
  let _buyVolumeFinal = 0
  let _sellVolumeFinal = 0

  if (_imbalance > 0) {
    for (let step = 0; step < _numBuys; step++) {
      if (buyOrders[step]._price > _clearingPrice) {
        _buyVolumeFinal += buyOrders[step]._size
      }
    }
    for (let step = 0; step < _numSells; step++) {
      if (sellOrders[step]._price <= _clearingPrice) {
        _sellVolumeFinal += sellOrders[step]._size
      }
    }
    const _upperbound = _prices[_prices.indexOf(_clearingPrice) + 1]
    let _newImbalance = _buyVolumeFinal - (_sellVolumeFinal * (_clearingPrice + minTickSize))
    while (_maxVolume === Math.min(_buyVolumeFinal, _sellVolumeFinal * (_clearingPrice + minTickSize)) && Math.abs(_newImbalance) < Math.abs(_imbalance) && _clearingPrice + minTickSize < _upperbound) {
      _clearingPrice += minTickSize
      _imbalance = _newImbalance
      _newImbalance = _buyVolumeFinal - (_sellVolumeFinal * (_clearingPrice + minTickSize))
    }
  } else {
    for (let step = 0; step < _numBuys; step++) {
      if (buyOrders[step]._price >= _clearingPrice) {
        _buyVolumeFinal += buyOrders[step]._size
      }
    }

    for (let step = 0; step < _numSells; step++) {
      if (sellOrders[step]._price < _clearingPrice) {
        _sellVolumeFinal += sellOrders[step]._size
      }
    }

    const _lowerbound = _prices[_prices.indexOf(_clearingPrice) - 1]
    
    let _newImbalance = _buyVolumeFinal - (_sellVolumeFinal * (_clearingPrice - minTickSize))
    while (_maxVolume === Math.min(_buyVolumeFinal, _sellVolumeFinal * (_clearingPrice - minTickSize)) && Math.abs(_newImbalance) < Math.abs(_imbalance) && _clearingPrice - minTickSize > _lowerbound) {
      _clearingPrice -= minTickSize
      _imbalance = _newImbalance
      _newImbalance = _buyVolumeFinal - (_sellVolumeFinal * (_clearingPrice - minTickSize))
    }
  }

  return {
    clearingPrice: _clearingPrice,
    volumeSettled: _maxVolume,
    imbalance: _imbalance
  }
}

async function GetOpenOrders(inst, precision) {
  const numBlockchainBuys = await inst._getNumBuyOrders()
  const numBlockchainSells = await inst._getNumSellOrders()
  const wTight = Number(await inst._getWidthTight())

  let blockchainBuyOrders = []
  let blockchainSellOrders = []

  for (let step = 0; step < numBlockchainBuys; step++) {
    const buyOrder = await inst._revealedBuyOrders.call(step)

    const w = Number(buyOrder._maxTradeableWidth)

    if (w >= wTight) {
      const p = buyOrder._price
      const s = buyOrder._size

      blockchainBuyOrders.push({
        _price: Number(p.toString()) / Number(precision),
        _size: Number(s.toString()) / Number(precision)
      })
    }
  }

  for (let step = 0; step < numBlockchainSells; step++) {
    const sellOrder = await inst._revealedSellOrders.call(step)

    const w = Number(sellOrder._maxTradeableWidth)

    if (w >= wTight) {
      const p = sellOrder._price
      const s = sellOrder._size

      blockchainSellOrders.push({
        _price: Number(p.toString()) / Number(precision),
        _size: Number(s.toString()) / Number(precision)
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
exports.GenerateMerkleProof = GenerateMerklePath
exports.GenerateProofOfDeposit = GenerateProofOfDeposit
exports.toHex = toHex
exports.OrderFromJSON = OrderFromJSON
exports.CalculateClearingPrice = CalculateClearingPrice
exports.GetOpenOrders = GetOpenOrders
