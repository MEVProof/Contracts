#!/bin/bash

ftdex(){
    node src/cli.js "$@"
}

prompt()
{
    echo "Press any key to" $1
    read -n 1
}


# alias ftdex="node src/cli.js"

yarn migrate:dev

rm state.*.json

prompt "start seeding deposits"

for i in {3..5}
do 
    ACCOUNT_INDEX=$i ftdex mint-tokens 9000000000000000000 9000000000000000000

    for j in {0..9}
    do
        ACCOUNT_INDEX=$i ftdex deposit
    done
done

ftdex change-phase commit

prompt "commit some orders" 

for i in {3..5}
do 
    for j in {0..3}
    do
        # side price qty
        ACCOUNT_INDEX=$i ftdex commit buy $((99 + 1 * $j)) $((4000))
        ACCOUNT_INDEX=$i ftdex commit sell $((102 - 1 * $j)) $((4000))
    done
done

# prompt "commit some MMs" 

# for i in {6..9}
# do 
#     ACCOUNT_INDEX=$i ftdex commit commit-mm $((998+$i)) $((1600 + 5* $j))
# done

prompt "move to reveal phase"

ftdex change-phase reveal

prompt "reveal all"

for i in {3..5}
do 
    ACCOUNT_INDEX=$i ftdex reveal-all
done


