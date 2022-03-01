/* global artifacts */
const Verifier = artifacts.require('Verifier')

module.exports = async function (deployer) {
  await deployer.deploy(Verifier)
}
