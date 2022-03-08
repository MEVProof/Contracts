// Generates Hasher artifact at compile-time using Truffle's external compiler
// mechanism
const path = require('path')
const fs = require('fs')
const genContract = require('circomlib/src/poseidon_gencontract.js')

// where Truffle will expect to find the results of the external compiler
// command
const outputDir = path.join(__dirname, '..', 'build')
const outputPath = path.join(outputDir, 'Hasher.json')

function main() {
  const contract = {
    contractName: 'Hasher',
    abi: genContract.generateABI(2),
    bytecode: genContract.createCode(2),
  }

  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(contract, null, 2))
}

main()
