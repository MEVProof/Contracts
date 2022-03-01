const snarkjs = require('snarkjs');
const circomlib = require('circomlib');

/** Generate random number of specified byte length */
const rbigint = nbytes => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes))

/** Compute pedersen hash */
const pedersenHash = data => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]

/** BigNumber to hex string of specified length */
function toHex(number, length = 32) {
    const str = number instanceof Buffer ? number.toString('hex') : snarkjs.bigInt(number).toString(16)
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
        return web3.utils.soliditySha3(
            { t: 'bool', v: this._isBuyOrder },
            { t: 'uint256', v: this._size },
            { t: 'uint256', v: this._price },
            { t: 'uint256', v: this._maxTradeableWidth },
            { t: 'address', v: this._owner });
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
            { t: 'uint256', v: this._bidPrice },
            { t: 'uint256', v: this._bidSize },
            { t: 'uint256', v: this._offerPrice },
            { t: 'uint256', v: this._offerSize },
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
    constructor(nullifier, randomness) {              
        this.nullifier = nullifier;
        this.randomness = randomness;

        this.nullifierHex = toHex(nullifier);
        this.randomnessHex = toHex(randomness);

        this.preimage = Buffer.concat([this.nullifier.leInt2Buff(31), this.randomness.leInt2Buff(31)]);

        this.commitment = pedersenHash(this.preimage);
        this.commitmentHex = toHex(this.commitment)

        this.nullifierHash = pedersenHash(this.nullifier.leInt2Buff(31));
        this.nullifierHashHex = toHex(this.nullifierHash);
      }
}

function GenerateDeposit() {
    return new Deposit(rbigint(31), rbigint(31));
}

async function generateMerkleProof(contract, deposit) {
    // Get all deposit events from smart contract and assemble merkle tree from them
    console.log('Getting current state from tornado contract')
    const events = await contract.getPastEvents('Deposit', { fromBlock: 0, toBlock: 'latest' })
    const leaves = events
      .sort((a, b) => a.returnValues.leafIndex - b.returnValues.leafIndex) // Sort events in chronological order
      .map(e => e.returnValues.commitment)
    const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves)
  
    // Find current commitment in the tree
    const depositEvent = events.find(e => e.returnValues.commitment === toHex(deposit.commitment))
    const leafIndex = depositEvent ? depositEvent.returnValues.leafIndex : -1
  
    // Validate that our data is correct
    const root = tree.root()
    const isValidRoot = await contract.methods.isKnownRoot(toHex(root)).call()
    const isSpent = await contract.methods.isSpent(toHex(deposit.nullifierHash)).call()
    // assert(isValidRoot === true, 'Merkle tree is corrupted')
    // assert(isSpent === false, 'The note is already spent')
    // assert(leafIndex >= 0, 'The deposit is not found in the tree')
  
    // Compute merkle proof of our commitment
    const { pathElements, pathIndices } = tree.path(leafIndex)
    return { pathElements, pathIndices, root: tree.root() }
  }

exports.Order = Order;
exports.MarketMakerOrder = MarketMakerOrder;
exports.Deposit = Deposit;
exports.GenerateDeposit = GenerateDeposit;