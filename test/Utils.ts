import { ClientAndMMInstance } from "../types/truffle-contracts"
import BN from 'bn.js'
import circomlib from 'circomlib'
import merkleTree from 'fixed-merkle-tree'

const { leBuff2int, leInt2Buff, stringifyBigInts } = require('ffjavascript').utils

const { randomBytes} = require('crypto')

const { prove } = require('./prover')

const { poseidon } = require('circomlib')

const FIELD_SIZE = new BN(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
)

function poseidonHash(items: any[]) {
  return new BN(poseidon(items).toString())
}

function poseidonHash2(a: any, b: any) {
  return poseidonHash([a, b])
}

/** Generate random number of specified byte length */
const rBN = (nbytes : number) => leBuff2int(randomBytes(nbytes))

/** Compute pedersen hash */
const pedersenHash = (data: any) => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]

/** BigNumber to hex string of specified length */
export function toHex (number: any, length = 32) : string {
  const str = number instanceof Buffer ? number.toString('hex') : new BN(number).toString(16)
  return '0x' + str.padStart(length * 2, '0')
}

export class Order  {
  public readonly _isBuyOrder : boolean
  public readonly _size: BN
  public readonly _price: BN
  public readonly _maxTradeableWidth: BN
  public readonly _owner: string

  constructor (isBuyOrder: boolean, size: BN, price: BN, maxTradeableWidth: BN, account: string) {
    this._isBuyOrder = isBuyOrder
    this._size = size
    this._price = price
    this._maxTradeableWidth = maxTradeableWidth
    this._owner = account
  }

  GetSolidityHash (): string {
    const hash = new BN(web3.utils.soliditySha3(
      { t: 'bool', v: this._isBuyOrder ? 1 : 0},
      { t: 'uint256', v: toHex(this._size) },
      { t: 'uint256', v: toHex(this._price) },
      { t: 'uint256', v: toHex(this._maxTradeableWidth) },
      { t: 'address', v: this._owner })!)

    return hash.mod(FIELD_SIZE).toString()
  }

  Unwrap (): { _isBuyOrder: boolean; _size: string; _price: string; _maxTradeableWidth: string; _owner: string } {
    return {
      _isBuyOrder: this._isBuyOrder,
      _size: this._size.toString(),
      _price: this._price.toString(),
      _maxTradeableWidth: this._maxTradeableWidth.toString(),
      _owner: this._owner
    }
  }
}

export class MarketMakerOrder {
  public readonly _bidPrice: BN
  public readonly _bidSize: BN
  public readonly _offerPrice: BN
  public readonly _offerSize: BN
  public readonly _owner: string

  constructor (bidPrice: BN, bidSize: BN, offerPrice: BN, offerSize: BN, owner: string) {
    this._bidPrice = bidPrice
    this._bidSize = bidSize
    this._offerPrice = offerPrice
    this._offerSize = offerSize
    this._owner = owner
  }

  GetSolidityHash () : string {
    return web3.utils.soliditySha3(
      { t: 'uint256', v: toHex(this._bidPrice) },
      { t: 'uint256', v: toHex(this._bidSize) },
      { t: 'uint256', v: toHex(this._offerPrice) },
      { t: 'uint256', v: toHex(this._offerSize) },
      { t: 'address', v: this._owner })!
  }

  Unwrap () {
    return {
      _bidPrice: this._bidPrice.toString(),
      _bidSize: this._bidSize.toString(),
      _offerPrice: this._offerPrice.toString(),
      _offerSize: this._offerSize.toString(),
      _owner: this._owner
    }
  };
}

export class Deposit {
  nullifier: BN
  randomness: BN
  nullifierHex: string
  randomnessHex: string
  preimage: Buffer
  commitment: any
  commitmentHex: string
  nullifierHash: BN
  nullifierHashHex: string
  nextHop: Deposit | null
  
  constructor (nullifier: BN, randomness: BN, nextHop : Deposit | null = null) {
    this.nullifier = nullifier
    this.randomness = randomness

    this.nullifierHex = toHex(nullifier)
    this.randomnessHex = toHex(randomness)

    this.preimage = Buffer.concat([leInt2Buff(this.nullifier, 31), leInt2Buff(this.randomness, 31)])

    this.commitment = new BN(toHex(pedersenHash(this.preimage)), 16).mod(FIELD_SIZE)
    this.commitmentHex = toHex(this.commitment)

    this.nullifierHash = new BN(toHex(pedersenHash(this.nullifier.toBuffer('le', 31))), 16).mod(FIELD_SIZE)
    this.nullifierHashHex = toHex(this.nullifierHash)

    this.nextHop = nextHop
  }
}

export function GenerateDeposit (withNextHop : boolean = false): Deposit {
  return new Deposit(rBN(31), rBN(31), withNextHop ? GenerateDeposit() : null)
}

const MERKLE_TREE_HEIGHT = 20

async function GenerateMerklePath (contract: ClientAndMMInstance, deposit: Deposit) {
  // Get all deposit events from smart contract and assemble merkle tree from them
  console.log('Getting current state from tornado contract')
  const events = await contract.getPastEvents('Deposit', { fromBlock: 0, toBlock: 'latest' })
  const leaves = events
    .sort((a, b) => a.returnValues.leafIndex - b.returnValues.leafIndex) // Sort events in chronological order
    .map((e) => e.returnValues.commitment)
  const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves, { hashFunction: poseidonHash2 })

  // Find current commitment in the tree
  const depositEvent = events.find((e) => e.returnValues.commitment === toHex(deposit.commitment))
  const leafIndex = depositEvent ? depositEvent.returnValues.leafIndex : -1

  // Validate that our data is correct
  const root = tree.root()
  const isValidRoot = await contract.isKnownRoot(toHex(root))
  const isSpent = await contract.isSpent(toHex(deposit.nullifierHash))
  assert(isValidRoot === true, 'Merkle tree is corrupted')
  assert(isSpent === false, 'The note is already spent')
  assert(leafIndex >= 0, 'The deposit is not found in the tree')

  // Compute merkle proof of our commitment
  const { pathElements, pathIndices } = tree.path(leafIndex)
  return { pathElements, pathIndices, root: tree.root() }
}

type ProofArgs = [string, string, string, string, string, string];

export async function GenerateProofOfDeposit (contract: ClientAndMMInstance, deposit: Deposit, orderHash: string, relayerAddress : string = '0x0', fee = 1, refund = 1) {
  // Compute merkle proof of our commitment
  const { root, pathElements, pathIndices } = await GenerateMerklePath(contract, deposit)

  // Prepare circuit input
  const input = stringifyBigInts({
    // Public snark inputs
    root: root,
    nullifierHash: deposit.nullifierHashHex,
    orderHash: orderHash,
    relayer: relayerAddress,
    fee: fee,
    refund: refund,

    // Private snark inputs
    nullifier: deposit.nullifierHex,
    secret: deposit.randomness,
    pathElements: pathElements,
    pathIndices: pathIndices
  })

  console.log(deposit)
  console.log(deposit.nullifierHash.toString(), deposit.nullifierHash.toString(16), deposit.nullifierHashHex)
  console.log(input)

  const proof = await prove(input, './artifacts/circuits/provideEscrow')

  const args : ProofArgs = [
    toHex(input.root),
    toHex(input.nullifierHash),
    toHex(input.orderHash),
    toHex(input.relayer, 20),
    toHex(input.fee),
    toHex(input.refund)
  ]

  return { proof, args }
}