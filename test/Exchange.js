const {
    BN,           // Big Number support
    constants,    // Common constants, like the zero address and largest integers
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
  } = require('@openzeppelin/test-helpers');

const chai = require('chai');
const chaiBn = require('chai-bn');
chai.use(chaiBn(BN));

const ERC20 = artifacts.require("ERC20Mock");
const Exchange = artifacts.require("Exchange");

contract('ERC20', async function (accounts) {
    it('setup', async function () {
        sender = accounts[0];
        receiver = accounts[1];

        // The bundled BN library is the same one web3 uses under the hood
        this.value = new BN(1);

        this.erc20 = await ERC20.new("Token B", "TKNB", 10**7);
        try {
        this.exchange = await Exchange.new(this.erc20);
        } catch(e){
            console.error(e);
            throw e;
        }
    });

    // it('reverts when transferring tokens to the zero address', async function () {
    //     // Conditions that trigger a require statement can be precisely tested
    //     await expectRevert(
    //     this.erc20.transfer(constants.ZERO_ADDRESS, this.value, { from: sender }),
    //     'ERC20: transfer to the zero address',
    //     );
    // });

    // it('emits a Transfer event on successful transfers', async function () {
    //     const receipt = await this.erc20.transfer(
    //     receiver, this.value, { from: sender }
    //     );

    //     // Event assertions can verify that the arguments are the expected ones
    //     expectEvent(receipt, 'Transfer', {
    //     from: sender,
    //     to: receiver,
    //     value: this.value,
    //     });
    // });

    // it('updates balances on successful transfers', async function () {
    //     this.erc20.transfer(receiver, this.value, { from: sender });

    //     // BN assertions are automatically available via chai-bn (if using Chai)
    //     expect(await this.erc20.balanceOf(receiver))
    //     .to.be.bignumber.equal(this.value);
    // });
});