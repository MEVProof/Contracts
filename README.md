# Contracts
Solidity contracts for FairTraDEX
## Requirements
NodeJS and NPM installed

## Instructions
```
npm install                         # Installs truffle and other tools
npm run build                       # At least once to generate ZK stuff
npx ganache-cli                     # In another window
npx truffle migrate:dev --reset     # Deploys contracts to ganache
npx truffle test                    # Runs tests
```