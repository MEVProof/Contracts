#!/bin/bash

ftdex(){
    node src/cli.js "$@"
}

# alias ftdex="node src/cli.js"

yarn migrate:dev

rm state.*.json

for i in {0..9}
do 
    ACCOUNT_INDEX=$i ftdex mint-tokens 9000000000000000000 9000000000000000000
done


# MM Shell
alias ftdex="node src/cli.js"

export ACCOUNT_INDEX=5
export PS1="[marketmaker@wintermute] $ "

ftdex mm-commit 099 4000 102 4000
ftdex mm-commit 100 5000 101 5000


# Trader Shell

alias ftdex="node src/cli.js"

export PS1="[trader@thecouch] $ "

ftdex deposit

ftdex change-phase commit

ftdex mm-commit 099 4000 102 4000
ftdex mm-commit 100 5000 101 5000

ftdex commit buy 101 500

ftdex change-phase reveal

ftdex reveal-all

ftdex settle-auction

# end trader shell

# node src/cli.js show-book

# ftdex reveal
# ftdex mm-reveal


# Observers

watch --no-title node src/cli show-book
watch --no-title node src/cli pool