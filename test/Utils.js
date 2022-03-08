const snarkjs = require('snarkjs');
const circomlib = require('circomlib');
const merkleTree = require('fixed-merkle-tree')
const ffUtils = require('ffjavascript').utils;
const leBuff2int = ffUtils.leBuff2int;
const leInt2Buff = ffUtils.leInt2Buff;
const stringifyBigInts = ffUtils.stringifyBigInts;

const bigInteger = require('big-integer');
const bigNumber = require('bn.js');

const {prove} = require('./prover');

const { poseidon } = require('circomlib')

const FIELD_SIZE = BigInt(
    '21888242871839275222246405745257275088548364400416034343698204186575808495617',
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
        this._isBuyOrder = isBuyOrder;
        this._size = size;
        this._price = price;
        this._maxTradeableWidth = maxTradeableWidth;
        this._owner = account;
    }

    GetSolidityHash() {
        const hash = BigInt(web3.utils.soliditySha3(
            { t: 'bool', v: this._isBuyOrder },
            { t: 'uint256', v: toHex(this._size) },
            { t: 'uint256', v: toHex(this._price) },
            { t: 'uint256', v: toHex(this._maxTradeableWidth) },
            { t: 'address', v: this._owner }));

        const modHash = hash.mod(FIELD_SIZE).toString();
        return modHash;
    }

    Unwrap() {
        return {
            '_isBuyOrder': this._isBuyOrder ? 1 : 0,
            '_size': this._size.toString(),
            '_price': this._price.toString(),
            '_maxTradeableWidth': this._maxTradeableWidth.toString(),
            '_owner': this._owner,
        };
    }
}

class MarketMakerOrder {
    constructor(bidPrice, bidSize, offerPrice, offerSize, owner) {
        this._bidPrice = bidPrice;
        this._bidSize = bidSize;
        this._offerPrice = offerPrice;
        this._offerSize = offerSize;
        this._owner = owner;
    }

    GetSolidityHash() {
        return web3.utils.soliditySha3(
            { t: 'uint256', v: Number(this._bidPrice) },
            { t: 'uint256', v: Number(this._bidSize) },
            { t: 'uint256', v: Number(this._offerPrice) },
            { t: 'uint256', v: Number(this._offerSize) },
            { t: 'address', v: this._owner });
    }

    Unwrap() {
        return {
            '_bidPrice': this._bidPrice.toString(),
            '_bidSize': this._bidSize.toString(),
            '_offerPrice': this._offerPrice.toString(),
            '_offerSize': this._offerSize.toString(),
            '_owner': this._owner
        }
    };
}
class Deposit {
    constructor(nullifier, randomness, nextHop = null) {
        this.nullifier = nullifier;
        this.randomness = randomness;

        this.nullifierHex = toHex(nullifier);
        this.randomnessHex = toHex(randomness);

        this.preimage = Buffer.concat([this.nullifier.leInt2Buff(31), this.randomness.leInt2Buff(31)]);

        this.commitment = BigInt(pedersenHash(this.preimage)).mod(FIELD_SIZE).toString();
        this.commitmentHex = toHex(this.commitment)

        this.nullifierHash = BigInt(pedersenHash(this.nullifier.leInt2Buff(31))).mod(FIELD_SIZE).toString();
        this.nullifierHashHex = toHex(this.nullifierHash);

        this.nextHop = nextHop;
    }
}

function GenerateDeposit(withNextHop = false) {
    return new Deposit(rbigint(31), rbigint(31), withNextHop ? GenerateDeposit() : null);
}

const MERKLE_TREE_HEIGHT = 20;

async function GenerateMerklePath(contract, deposit) {
    // Get all deposit events from smart contract and assemble merkle tree from them
    console.log('Getting current state from tornado contract')
    const events = await contract.getPastEvents('Deposit', { fromBlock: 0, toBlock: 'latest' })
    const leaves = events
        .sort((a, b) => a.returnValues.leafIndex - b.returnValues.leafIndex) // Sort events in chronological order
        .map(e => e.returnValues.commitment)
    const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves, { hashFunction: poseidonHash2})

    // Find current commitment in the tree
    const depositEvent = events.find(e => e.returnValues.commitment === toHex(deposit.commitment))
    const leafIndex = depositEvent ? depositEvent.returnValues.leafIndex : -1

    // Validate that our data is correct
    const root = tree.root()
    // const isValidRoot = await contract.isKnownRoot(toHex(root)).call()
    // const isSpent = await contract.isSpent(toHex(deposit.nullifierHash)).call()
    // assert(isValidRoot === true, 'Merkle tree is corrupted')
    // assert(isSpent === false, 'The note is already spent')
    assert(leafIndex >= 0, 'The deposit is not found in the tree')

    // Compute merkle proof of our commitment
    const { pathElements, pathIndices } = tree.path(leafIndex)
    return { pathElements, pathIndices, root: tree.root() }
}

async function GenerateProofOfDeposit(contract, deposit, orderHash, relayerAddress = 0, fee = 1, refund = 1 ) {
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
      pathIndices: pathIndices,
    });

    const proof = await prove(input, `./artifacts/circuits/provideEscrow`);

    const args = [
      toHex(input.root),
      toHex(input.nullifierHash),
      toHex(input.orderHash),
      toHex(input.relayer, 20),
      toHex(input.fee),
      toHex(input.refund),
    ]
  
    return { proof, args }
  }

exports.Order = Order;
exports.MarketMakerOrder = MarketMakerOrder;
exports.Deposit = Deposit;
exports.GenerateDeposit = GenerateDeposit;
exports.GenerateMerkleProof = GenerateMerklePath;
exports.GenerateProofOfDeposit = GenerateProofOfDeposit;
exports.toHex = toHex;