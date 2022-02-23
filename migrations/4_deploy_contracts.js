const Escrow = artifacts.require("Escrow");
const ERC20Mock = artifacts.require('ERC20Mock');
const Exchange = artifacts.require('Exchange');
const Client = artifacts.require('ClientAndMM');

module.exports = function (deployer) {
  return deployer.then(async () => {
    // TODO: Add branch here for testing vs production. Don't need to deploy
    // any token contracts in production.
    const tokenInstance = await deployer.deploy(ERC20Mock, "Token B", "TKNB");
    const token = tokenInstance.address;

    await deployer.deploy(Exchange, token);

    await deployer.deploy(Client);
    
    await deployer.deploy(Escrow);
  });
};
