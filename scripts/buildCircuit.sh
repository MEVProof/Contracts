#!/bin/bash -e
POWERS_OF_TAU=15 # circuit will support max 2^POWERS_OF_TAU constraints
mkdir -p artifacts/circuits
if [ ! -f artifacts/circuits/ptau$POWERS_OF_TAU ]; then
  echo "Downloading powers of tau file"
  curl -L https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_$POWERS_OF_TAU.ptau --create-dirs -o artifacts/circuits/ptau$POWERS_OF_TAU
fi
npx circom -v -r artifacts/circuits/provideEscrow.r1cs -w artifacts/circuits/provideEscrow.wasm -s artifacts/circuits/provideEscrow.sym circuits/provideEscrow.circom
npx snarkjs groth16 setup artifacts/circuits/provideEscrow.r1cs artifacts/circuits/ptau$POWERS_OF_TAU artifacts/circuits/tmp_provideEscrow.zkey
echo "qwe" | npx snarkjs zkey contribute artifacts/circuits/tmp_provideEscrow.zkey artifacts/circuits/provideEscrow.zkey
npx snarkjs zkey export solidityverifier artifacts/circuits/provideEscrow.zkey artifacts/circuits/Verifier.sol
sed -i.bak "s/pragma solidity ^0.7.0/pragma solidity >=0.4.22 <0.9.0/g" artifacts/circuits/Verifier.sol
#zkutil setup -c artifacts/circuits/provideEscrow.r1cs -p artifacts/circuits/provideEscrow.params
#zkutil generate-verifier -p artifacts/circuits/provideEscrow.params -v artifacts/circuits/Verifier.sol
npx snarkjs info -r artifacts/circuits/provideEscrow.r1cs
