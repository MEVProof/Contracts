const Escrow = artifacts.require("Escrow");
const TokenA = artifacts.require('TokenA');
const TokenB = artifacts.require('TokenB');
const Exchange = artifacts.require('Exchange');
const Client = artifacts.require('ClientAndMM');

module.exports = function (deployer) {
  return deployer.then(async () => {
    // TODO: Add branch here for testing vs production. Don't need to deploy
    // any token contracts in production.
    const tokenA = await deployer.deploy(TokenA, "Token A", "TKNA");
    const tokenB = await deployer.deploy(TokenB, "Token B", "TKNB");

    await deployer.deploy(Exchange, tokenB.address);

    await deployer.deploy(Client, tokenA.address, tokenB.address);
    
    await deployer.deploy(Escrow);
  });
};
