const commander = require('commander');
const program = new commander.Command();

const Utils = require(__dirname + '/../test/Utils.js')
const Web3 = require('web3')
const { toWei, fromWei, toBN, BN } = require('web3-utils')
const fs = require('fs');


let netId = ""

let web3, exchange, account, token_a, token_b, state

const decimalPoints = 10
const precision = BigInt(Math.pow(10, decimalPoints))

const rpc = 'http://localhost:8545'
const clientDepositAmount = 2

function ParsePhase(phase) {
    switch (Number(phase)) {
        case 0:
            return "Inactive";
        case 1:
            return "Commit";
        case 2:
            return "Reveal";
        case 3:
            return "Resolution"
        default:
            return 'Unknown (' + phase + ')'
    }
}

async function PrintPoolDetails() {
    console.log('Pool details');
    console.log({
        'Token_A': await token_a.methods.symbol().call(),
        'Token_B': await token_b.methods.symbol().call(),

        'Phase': ParsePhase(await exchange.methods._phase().call()),
        'CommittedOrders': await exchange.methods._unrevealedOrderCount().call(),
        'CommittedMarkets': await exchange.methods._unrevealedMarketCount().call(),

        'NumRevealedBuyOrders': await exchange.methods._getNumBuyOrders().call(),
        'NumRevealedSellOrders': await exchange.methods._getNumSellOrders().call(),
    })
}

async function ConfigureToken(pathToContractJson) {
    contractJson = require(pathToContractJson)
    contractAddress = contractJson.networks[netId].address

    return new web3.eth.Contract(contractJson.abi, contractAddress)
}

async function AddDeposit() {
    deposit = Utils.GenerateDeposit();

    await exchange.methods.Client_Register(deposit.commitmentHex).send({ from: account.address, value: clientDepositAmount, gas: 2e6 });

    state.unspentDeposits.push(deposit);

    console.log('Added deposit of %d to pool %s. Deposit id %s', clientDepositAmount, exchange._address.toString(), deposit.commitmentHex)
}

async function CommitOrder(side, price, quantity, maxTradeableWidth, deposit) {
    const order = new Utils.Order(side === "buy", BigInt(quantity) * precision, BigInt(price) * precision, BigInt(maxTradeableWidth) * precision, account.address);

    if (deposit === undefined) {
        if (state.unspentDeposits.length > 0) {
            console.log("No deposit provided. Using saved deposit")
            deposit = state.unspentDeposits.pop();
        } else {
            throw new Error("No deposit provided and no saved deposits available")
        }
    }

    const depositProof = await Utils.GenerateProofOfDeposit(exchange, deposit, order.GetSolidityHash())

    await exchange.methods
        .Client_Commit(depositProof.proof, ...depositProof.args)
        .send({ from: account.address, gas: 2e6 });

    state.committedOrders.push({ order: order, deposit: deposit });

    console.log('Commited to order %s', order.GetSolidityHash())
}

async function CommitMMOrder(bidPrice, bidSize, offerPrice, offerSize) {
    const order = new Utils.MarketMakerOrder(BigInt(bidPrice) * precision, BigInt(bidSize) * precision, BigInt(offerPrice) * precision, BigInt(offerSize) * precision, account.address);

    await exchange.methods
        .MM_Commit(order.GetSolidityHash())
        .send({ from: account.address, gas: 2e6, value: 10 }); // TODO: Send correct Escrow

    state.committedMMOrders.push({ order: order });

    console.log('Commited to MM Order %s', order.GetSolidityHash())
}

async function ChangePhase(phase) {
    if (phase === 'reveal') {
        await exchange.methods.Move_To_Reveal_Phase().send({ from: account.address, gas: 2e6 });
    } else if (phase === 'commit') {
        await exchange.methods.Move_To_Commit_Phase().send({ from: account.address, gas: 2e6 });
    } else if (phase === 'resolution') {
        await exchange.methods.Move_To_Resolution_Phase().send({ from: account.address, gas: 2e10 });
    } else if (phase === 'inactive') {
        await exchange.methods.Move_To_Inactive_Phase().send({ from: account.address, gas: 2e10 });
    } else {
        throw new Error("Unexpected phase: " + phase)
    }
}

async function RevealOrder(orderHash) {
    const committedOrders = state.committedOrders.map(order => { return order === null ? null : { order: Utils.OrderFromJSON(order.order), deposit: order.deposit }; })

    if (orderHash === undefined) {
        throw new Error("No Order Hash provided")
    }

    const matchIndex = committedOrders.findIndex(order => order === null ? false : order.order.GetSolidityHash() === orderHash);

    if (matchIndex === -1) {
        throw new Error("No commited order matching provided hash found")
    }

    const { order, deposit } = committedOrders[matchIndex];

    await RevealSingleOrder(order, deposit);

    state.committedOrders[matchIndex] = null
}

async function RevealSingleOrder(order, deposit) {
    // TODO: Fix this
    await token_a.methods.approve(exchange._address, order._size).send({ from: account.address });
    await token_b.methods.approve(exchange._address, order._size).send({ from: account.address });

    console.log('Token transfer approved');

    await exchange.methods
        .Client_Reveal(Utils.toHex(order.GetSolidityHash()), order.Unwrap(), deposit.nullifierHex, deposit.randomnessHex, deposit.commitmentHex, '0x0')
        .send({ from: account.address, gas: 2e6 });

    console.log('Revealed order %s', order.GetSolidityHash());
}

async function RevealMMOrder(orderHash) {
    const committedOrders = state.committedMMOrders.map(order => { return order === null ? null : { order: Utils.MMOrderFromJSON(order.order), deposit: order.deposit }; })

    if (orderHash === undefined) {
        throw new Error("No Order Hash provided")
    }

    const matchIndex = committedOrders.findIndex(order => order === null ? false : order.order.GetSolidityHash() === orderHash);

    if (matchIndex === -1) {
        throw new Error("No commited order matching provided hash found")
    }

    const { order } = committedOrders[matchIndex];

    await RevealSingleMMOrder(order);

    state.committedMMOrders[matchIndex] = null;
}

async function RevealSingleMMOrder(order) {
    // TODO: Fix this
    await token_a.methods.approve(exchange._address, Number(order._offerSize) + Number(order._bidSize)).send({ from: account.address });
    await token_b.methods.approve(exchange._address, Number(order._offerSize) + Number(order._bidSize)).send({ from: account.address });

    console.log('Token transfer approved');

    await exchange.methods
        .MM_Reveal(Utils.toHex(order.GetSolidityHash()), order.Unwrap())
        .send({ from: account.address, gas: 2e6 });

    console.log('Revealed order %s', order.GetSolidityHash());
}

async function RevealAll() {
    for (let index = 0; index < state.committedMMOrders.length; index++) {
        if (null === state.committedMMOrders[index]) {
            continue;
        }
        
        const order = state.committedMMOrders[index].order;

        await RevealSingleMMOrder(Utils.MMOrderFromJSON(order));

        state.committedMMOrders[index] = null;
    }

    for (let index = 0; index < state.committedOrders.length; index++) {
        if (null === state.committedOrders[index]) {
            continue;
        }

        const { order, deposit } = state.committedOrders[index];

        await RevealSingleOrder(Utils.OrderFromJSON(order), deposit);

        state.committedOrders[index] = null;
    }
}

async function ShowOrderBook() {
    let { blockchainBuyOrders, blockchainSellOrders } = await Utils.GetOpenOrders(exchange, precision, checkWidth=false)

    blockchainBuyOrders.sort((a, b) => a.price - b.price);
    blockchainSellOrders.sort((a, b) => b.price - a.price);

    console.log("Buy Orders:");

    if (blockchainBuyOrders.length > 0) {
        blockchainBuyOrders.forEach(order => {
            console.log('\t%d\t%d\t%s', order.price * Number(precision), order.size, order.owner == account.address ? "*" : "");
        });
    } else {
        console.log('==== No Orders ====');
    }

    console.log();

    console.log("Sell Orders:");

    if (blockchainSellOrders.length > 0) {
        blockchainSellOrders.forEach(order => {
            console.log('\t%d\t%d', order.price * Number(precision), order.size, order.owner == account.address ? "*" : "");
        });
    } else {
        console.log('==== No Orders ====');
    }
}

async function ShowBalances() {
    const tokens = [token_a, token_b];
    for (const token of tokens) {
        const symbol = await token.methods.symbol().call();
        const balance = await token.methods.balanceOf(account.address).call({ from: account.address });

        console.log(`${symbol}: ${balance}`);
    }
}

async function MintTokens(tokenAQuantity, tokenBQuantity) {
    await token_a.methods.mint(account.address, tokenAQuantity).send({ from: account.address });
    await token_b.methods.mint(account.address, tokenBQuantity).send({ from: account.address });

    await ShowBalances();
}

async function SettleAuction() {
    const { blockchainBuyOrders, blockchainSellOrders } = await Utils.GetOpenOrders(exchange, precision)
    const minTickSize = Number(await exchange.methods._getMinTickSize().call()) / Number(precision)

    clearingInfo = Utils.CalculateClearingPrice(blockchainBuyOrders, blockchainSellOrders, minTickSize)
    clearingInfo.clearingPrice = BigInt(Math.round(Number(clearingInfo.clearingPrice) * Number(precision)))

    await exchange.methods.clearingPriceConvertor(
        clearingInfo.clearingPrice, 
        BigInt(Math.floor(Number(clearingInfo.volumeSettled))), 
        BigInt(Math.floor(Number(clearingInfo.imbalance))))
        .send({ from: account.address, gasLimit: 10000000 })

    clearingInfo.volumeSettled = BigInt(Number(await exchange.methods._getSolVolumeSettled().call()))
    clearingInfo.imbalance = BigInt(Number(await exchange.methods._getSolImbalance().call()))

    console.log('clearing price:', Number(clearingInfo.clearingPrice) / Number(precision), ', volume settled in token A:', Number(clearingInfo.volumeSettled) / Number(precision), ', imbalance:', Number(clearingInfo.imbalance) / Number(precision))

    reg = await exchange.methods
        .Settlement(clearingInfo.clearingPrice, clearingInfo.volumeSettled, clearingInfo.imbalance)
        .send({ from: account.address, gasLimit: 10000000, value: 1 }) // TODO: Value
}

function LoadState(pathToState) {
    let state;

    if (fs.existsSync(pathToState)) {
        state = JSON.parse(fs.readFileSync(pathToState, 'utf8'));
    } else {
        state = {};
    }

    if (state.unspentDeposits === undefined) {
        state.unspentDeposits = [];
    }

    if (state.committedOrders === undefined) {
        state.committedOrders = [];
    }

    if (state.committedMMOrders === undefined) {
        state.committedMMOrders = [];
    }

    return state;
}

async function main() {
    web3 = new Web3(rpc, null, { transactionConfirmationBlocks: 1 })

    netId = await web3.eth.net.getId()
    contractJson = require(__dirname + '/../build/contracts/ClientAndMM.json')
    contractAddress = contractJson.networks[netId].address
    exchange = new web3.eth.Contract(contractJson.abi, contractAddress)

    token_a = await ConfigureToken(__dirname + '/../build/contracts/TokenA.json');
    token_b = await ConfigureToken(__dirname + '/../build/contracts/TokenB.json');

    account = web3.eth.accounts.privateKeyToAccount('0x' + '4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d'.toUpperCase())

    state = LoadState('state.json');

    program
        .name('FairTraDEX CLI')
        .description('CLI to FairTraDEX DApp')
        .version('0.1.0');

    program
        .command('pool [pool]')
        .description('Show pool details')
        .action(async (pool) => {
            // TODO: Pool?
            await PrintPoolDetails();
        });

    program
        .command('show-book')
        .description('Show order book.')
        .action(ShowOrderBook);

    program
        .command('check-balances')
        .description('Check token balances.')
        .action(ShowBalances);

    program
        .command('mint-tokens')
        .description('Test command. Mints tokens to trade with.')
        .addArgument(new commander.Argument('<tokenAQuantity>'))
        .addArgument(new commander.Argument('<tokenBQuantity>'))
        .action(MintTokens)

    program
        .command('deposit')
        .description('Create a new deposit to be used when committing to an order')
        .action(async () => {
            await AddDeposit();
        });

    program
        .command('commit')
        .description('Commit to an order. Sends irrevokable commititment to trade with all order parameters set.')
        .addArgument(new commander.Argument('<side>').choices(['buy', 'sell']))
        .addArgument(new commander.Argument('<price>'))
        .addArgument(new commander.Argument('<quantity>'))
        .addArgument(new commander.Argument('[maxTradeableWidth]').default(1000))
        .addArgument(new commander.Argument('[deposit]', "Deposit to commit order with."))
        .action(async (side, price, quantity, maxTradeableWidth) => {
            await CommitOrder(side, price, quantity, maxTradeableWidth);
        });

    program
        .command('reveal')
        .description('Reveal a previously commited order. See "commit".')
        .argument('<commitment>', 'Hash of commited order to reveal')
        .action(async (commitment) => {
            await RevealOrder(commitment);
        })

    program
        .command('mm-commit')
        .description('Market Maker commit to an order. Sends irrevokable commititment to trade with all order parameters set.')
        .addArgument(new commander.Argument('<bidPrice>'))
        .addArgument(new commander.Argument('<bidQuantity>'))
        .addArgument(new commander.Argument('<askPrice>'))
        .addArgument(new commander.Argument('<askQuantity>'))
        .action(async (bidPrice, bidQuantity, offerPrice, offerQuantity) => {
            await CommitMMOrder(bidPrice, bidQuantity, offerPrice, offerQuantity);
        });

    program
        .command('mm-reveal')
        .description('Reveal a previously commited MM order. See "mm-commit".')
        .argument('<commitment>', 'Hash of commited order to reveal')
        .action(async (commitment) => {
            await RevealMMOrder(commitment);
        })

    program
        .command('reveal-all')
        .description('Reveal all previously commited orders and MM orders.')
        .action(async () => {
            await RevealAll();
        })

    program
        .command('change-phase')
        .description('Changes state of the auction')
        .addArgument(new commander.Argument('<phase>', "Phase to change to")
            .choices(['commit', 'reveal', 'resolution', 'inactive']))
        .description('Change auction phase')
        .action(async (phase) => {
            await ChangePhase(phase);
        });

    program
        .command('settle-auction')
        .description('Calculates the clearing price and submits on chain to complete the auction')
        .action(async () => {
            await SettleAuction();
        });

    try {
        await program.parseAsync(process.argv);

        fs.writeFileSync('state.json', JSON.stringify(state, (key, value) =>
            typeof value === 'bigint'
                ? value.toString()
                : value // return everything else unchanged
            , 2));
    } catch (e) {
        console.error(e)
    }

    process.exit(0)
}

main();