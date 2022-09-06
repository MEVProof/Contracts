#!/bin/bash

ftdex(){
    node src/cli.js "$@"
}

# alias ftdex="node src/cli.js"

yarn migrate:dev

rm state.json

ftdex mint-tokens 100000000000000 1000000000000000

ftdex deposit
ftdex deposit
ftdex deposit

ftdex change-phase commit

ftdex mm-commit 099 4000 102 4000
ftdex mm-commit 100 5000 101 5000

ftdex commit buy 101 500

ftdex change-phase reveal

ftdex reveal-all

ftdex settle-auction

# node src/cli.js show-book

# ftdex reveal
# ftdex mm-reveal
