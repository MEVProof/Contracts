import { groth16 } from 'snarkjs'
import { utils } from 'ffjavascript'

/** BigNumber to hex string of specified length */
function toHex (number: string | number | bigint | boolean | Buffer, length = 32): string {
  const str = number instanceof Buffer ? number.toString('hex') : BigInt(number).toString(16)
  return '0x' + str.padStart(length * 2, '0')
}

async function prove (input : any, keyBasePath : string): Promise<string> {
  const { proof } = await groth16.fullProve(
    utils.stringifyBigInts(input),
    `${keyBasePath}.wasm`,
    `${keyBasePath}.zkey`
  )

  return (
    '0x' +
    toHex(proof.pi_a[0]).slice(2) +
    toHex(proof.pi_a[1]).slice(2) +
    toHex(proof.pi_b[0][1]).slice(2) +
    toHex(proof.pi_b[0][0]).slice(2) +
    toHex(proof.pi_b[1][1]).slice(2) +
    toHex(proof.pi_b[1][0]).slice(2) +
    toHex(proof.pi_c[0]).slice(2) +
    toHex(proof.pi_c[1]).slice(2)
  )
}

module.exports = { prove }
