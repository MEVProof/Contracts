const TokenA = artifacts.require('TokenA');
const TokenB = artifacts.require('TokenB');
const Client = artifacts.require('ClientAndMM');
const Verifier = artifacts.require('Verifier');
const Hasher = artifacts.require('Hasher');

module.exports = function (deployer) {
  return deployer.then(async () => {
    // TODO: Add branch here for testing vs production. Don't need to deploy
    // any token contracts in production.
    const tokenA = await deployer.deploy(TokenA, "Token A", "TKNA");
    const tokenB = await deployer.deploy(TokenB, "Token B", "TKNB");

    const verifier = await Verifier.deployed()
    const hasher = await Hasher.deployed()

    await deployer.deploy(Client, verifier.address, hasher.address, tokenA.address, tokenB.address);
  });
};