const utils = require(__dirname + '/../test/Utils.js')
const Web3 = require('web3')
const { toWei, fromWei, toBN, BN } = require('web3-utils')

let netId = ""
let unspentDeposits = []
let committedOrders = []

let web3, exchange, account, token_a, token_b

const rpc = 'http://localhost:8545'
const clientDepositAmount = 2

const config = {
    'accounts': [
        '0x4F3EDF983AC636A65A842CE7C78D9AA706D3B113BCE9C46F30D7D21715B23B1D',
        '0x6CBED15C793CE57650B9877CF6FA156FBEF513C4E6134F022A85B1FFDD59B2A1',
        '0x6370FD033278C143179D81C5526140625662B8DAA446C22EE2D73DB3707E620C',
        '0x646F1CE2FDAD0E6DEEEB5C7E8E5543BDDE65E86029E2FD9FC169899C440A7913',
        '0xADD53F9A7E588D003326D1CBF9E4A43C061AADD9BC938C843A79E7B4FD2AD743',
        '0x395DF67F0C2D2D9FE1AD08D1BC8B6627011959B79C53D7DD6A3536A33AB8A4FD',
        '0xE485D098507F54E7733A205420DFDDBE58DB035FA577FC294EBD14DB90767A52',
        '0xA453611D9419D0E56F499079478FD72C37B251A94BFDE4D19872C44CF65386E3',
        '0x829E924FDF021BA3DBBC4225EDFECE9ACA04B929D6E75613329CA6F1D31C0BB4',
        '0xB0057716D5917BADAF911B193B12B910811C1497B5BADA8D7711F758981C3773',
    ]
}

async function TestSetup() {

    config.accounts.forEach(pk => {
        account = web3.eth.accounts.privateKeyToAccount(pk)
    });
}

async function PrintPoolDetails(){
    console.log('Pool details');
        console.log({
        'Token_A' : await token_a.methods.symbol().call(),
        'Token_B' : await token_b.methods.symbol().call(),

        'Phase' : await exchange.methods._phase().call(),
        'CommittedOrders' : await exchange.methods._committedOrderCount().call(),

        'NumRevealedBuyOrders' : await exchange.methods._getNumBuyOrders().call(),
        'NumRevealedSellOrders' : await exchange.methods._getNumSellOrders().call(),

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

    unspentDeposits.push(deposit);

    console.log('Added deposit of %d to pool %s. Deposit id %s', clientDepositAmount, exchange._address.toString(), deposit.commitmentHex)
}

async function CommitOrder() {
    const order = new utils.Order(true, 100, 100000, 1000, account.address);
    const deposit = unspentDeposits.pop();

    const depositProof = await utils.GenerateProofOfDeposit(exchange, deposit, order.GetSolidityHash())

    await exchange.methods
        .Client_Commit(depositProof.proof, ...depositProof.args)
        .send({ from: account.address, gas: 2e6 });

    committedOrders.push({ order: order, deposit: deposit });

    console.log('Commited to order %s', order.GetSolidityHash())
}

async function ChangePhase(phase) {
    if (phase === 'reveal'){
        await exchange.methods.Move_To_Reveal_Phase().send({ from: account.address });
    } else if (phase === 'commit') {
        await exchange.methods.Move_To_Commit_Phase().send({ from: account.address });
    }
}

async function RevealOrder() {
    const { order, deposit } = committedOrders.pop();

    const token = !order.isBuy ? token_a : token_b;

    await token.methods.mint(account.address, order._size).send({ from: account.address });
    await token.methods.approve(exchange._address, order._size).send({ from: account.address });

    await exchange.methods
        .Client_Reveal(utils.toHex(order.GetSolidityHash()), order.Unwrap(), deposit.nullifierHex, deposit.randomnessHex, deposit.commitmentHex, '0x0')
        .send({ from: account.address, gas: 2e6 })

    console.log('Revealed order %s', order.GetSolidityHash())
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

    await ChangePhase('commit')

    await PrintPoolDetails();

    await TestSetup()

    await AddDeposit()

    await ChangePhase('commit')

    await CommitOrder()

    await ChangePhase('reveal')

    await RevealOrder()

    await PrintPoolDetails();

    process.exit(0)
}

main();