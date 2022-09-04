const commander = require('commander');
const program = new commander.Command();

const utils = require(__dirname + '/../test/Utils.js')
const Web3 = require('web3')
const { toWei, fromWei, toBN, BN } = require('web3-utils')
const fs = require('fs');


let netId = ""

let web3, exchange, account, token_a, token_b, state

const rpc = 'http://localhost:8545'
const clientDepositAmount = 2

async function PrintPoolDetails() {
    console.log('Pool details');
    console.log({
        'Token_A': await token_a.methods.symbol().call(),
        'Token_B': await token_b.methods.symbol().call(),

        'Phase': await exchange.methods._phase().call(),
        'CommittedOrders': await exchange.methods._unrevealedOrderCount().call(),

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
    deposit = utils.GenerateDeposit();

    await exchange.methods.Client_Register(deposit.commitmentHex).send({ from: account.address, value: clientDepositAmount, gas: 2e6 });

    state.unspentDeposits.push(deposit);

    console.log('Added deposit of %d to pool %s. Deposit id %s', clientDepositAmount, exchange._address.toString(), deposit.commitmentHex)
}

async function CommitOrder(side, price, quantity, maxTradeableWidth, deposit) {
    const order = new utils.Order(side === "buy", price, quantity, maxTradeableWidth, account.address);

    if (deposit === undefined) {
        if (state.unspentDeposits.length > 0) {
            console.log("No deposit provided. Using saved deposit")
            deposit = state.unspentDeposits.pop();
        } else {
            throw new Error("No deposit provided and no saved deposits available")
        }
    }

    const depositProof = await utils.GenerateProofOfDeposit(exchange, deposit, order.GetSolidityHash())

    await exchange.methods
        .Client_Commit(depositProof.proof, ...depositProof.args)
        .send({ from: account.address, gas: 2e6 });

    state.committedOrders.push({ order: order, deposit: deposit });

    console.log('Commited to order %s', order.GetSolidityHash())
}

async function ChangePhase(phase) {
    if (phase === 'reveal') {
        await exchange.methods.Move_To_Reveal_Phase().send({ from: account.address, gas: 2e6});
    } else if (phase === 'commit') {
        await exchange.methods.Move_To_Commit_Phase().send({ from: account.address, gas: 2e6 });
    } else {
        throw new Error("Unexpected phase: " + phase)
    }
}

async function RevealOrder(orderHash) {
    const committedOrders = state.committedOrders.map(order => 
        { return order === null ? null : { order: utils.OrderFromJSON(order.order), deposit: order.deposit };})
    
    if (orderHash === undefined) {
        throw new Error("No Order Hash provided")
    }

    const matchIndex = committedOrders.findIndex(order => order === null ? false : order.order.GetSolidityHash() === orderHash);

    if (matchIndex === -1) {
        throw new Error("No commited order matching provided hash found")
    }

    const {order, deposit} = committedOrders[matchIndex];

    const token = order._isBuy ? token_a : token_b;

    // TODO: Fix this
    await token_a.methods.approve(exchange._address, order._size).send({ from: account.address });
    await token_b.methods.approve(exchange._address, order._size).send({ from: account.address });

    console.log('Token transfer approved')

    await exchange.methods
        .Client_Reveal(utils.toHex(order.GetSolidityHash()), order.Unwrap(), deposit.nullifierHex, deposit.randomnessHex, deposit.commitmentHex, '0x0')
        .send({ from: account.address, gas: 2e6 })

    console.log('Revealed order %s', order.GetSolidityHash())

    state.committedOrders[matchIndex] = null
}

async function ShowOrderBook() {
    const numBlockchainBuys = await exchange.methods._getNumBuyOrders().call()
    const numBlockchainSells = await exchange.methods._getNumSellOrders().call()

    let buyOrders = []
    let sellOrders = []

    for (let index = 0; index < numBlockchainBuys; index++) {
        const element = await exchange.methods._revealedBuyOrders(index).call();
        buyOrders.push(element);
    }

    for (let index = 0; index < numBlockchainSells; index++) {
        const element = await exchange.methods._revealedSellOrders(index).call();
        sellOrders.push(element);
    }

    buyOrders.sort((a, b) => a._price - b._price);
    sellOrders.sort((a, b) => b._price - a._price);

    console.log("Buy Orders:");

    if (buyOrders.length > 0) {
        buyOrders.forEach(order => {
            console.log('\t%d\t%d\t%s', order._price, order._size, order._owner == account.address ? "*" : "");
        });
    } else {
        console.log('==== No Orders ====');
    }

    console.log();

    console.log("Sell Orders:");

    if (sellOrders.length > 0) {
        sellOrders.forEach(order => {
            console.log('\t%d\t%d', order._price, order._size, order._owner == account.address ? "*" : "");
        });
    } else {
        console.log('==== No Orders ====');
    }
}

async function ShowBalances() {
    const tokens = [token_a, token_b];
    for (const token of tokens){
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
        .command('change-phase')
        .description('Changes state of the auction')
        .addArgument(new commander.Argument('<phase>', "Phase to change to")
            .choices(['commit', 'reveal']))
        .description('Change auction phase')
        .action(async (phase) => {
            await ChangePhase(phase);
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