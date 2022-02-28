const {
    BN,           // Big Number support
    constants,    // Common constants, like the zero address and largest integers
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
  } = require('@openzeppelin/test-helpers');

const chai = require('chai');
const chaiBn = require('chai-bn');
chai.use(chaiBn(BN));

require('chai').use(require('chai-bn')(web3.utils.BN))

const ERC20 = artifacts.require("TokenA");
const Exchange = artifacts.require("Exchange");

contract('Exchange', async function (accounts) {
    it('setup', async function () {
        sender = accounts[0];
        receiver = accounts[1];

        // The bundled BN library is the same one web3 uses under the hood
        this.value = new web3.utils.BN(1);

        this.erc20 = await ERC20.deployed();
        this.exchange = await Exchange.deployed();

        await this.erc20.mint(this.exchange.address, 100000000000);
    });

    it('simple trade balances', async function() {
        await this.exchange.RevealClient([{direction: 0, size: 1, price: 1, maxTradeableWidth: 100000, owner: sender}]);
        await this.exchange.RevealClient([{direction: 1, size: 1, price: 1, maxTradeableWidth: 100000, owner: sender}]);

        // await this.exchange.Settlement(1, 1, 0);
    });
});