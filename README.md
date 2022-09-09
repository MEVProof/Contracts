# Contracts
Solidity contracts for FairTraDEX
## Requirements
NodeJS and NPM installed

## Instructions
```
yarn install                        # Installs truffle and other tools
yarn build                          # At least once to generate ZK stuff
yarn ganache                        # In another window
yarn migrate:dev                    # Deploys contracts to ganache
yarn test                           # Runs tests
```

## CLI Usage
We've provided a command line interface to interact with FairTraDEX. It's located in `src/cli.js`.

See below for an example of a full auction driven using only the CLI. You can also interogate `ftdex` using `-h|--help` to get a detailed list
of all the available commands and their parameters.

```bash
# Alias for convenience
alias ftdex="node src/cli.js" 

# Give us something to play with
ftdex mint-tokens 1000000000000000 1000000000000000

ftdex deposit

ftdex change-phase commit

ftdex mm-commit 099 4000 102 4000
ftdex mm-commit 100 5000 101 5000

ftdex commit buy 101 500

ftdex change-phase reveal

ftdex reveal-all

ftdex settle-auction
```