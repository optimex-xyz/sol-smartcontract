import { Connection, PublicKey } from '@solana/web3.js'

import { getOptimexProgram } from '../artifacts'

/**
 * Parameter for adding operator
 */
export type AddOperatorInstructionParam = {
  /**
   * The signer authority who can manage operator
   * Must be the upgrade authority of the program
   */
  signer: PublicKey
  /**
   * The operator we want to add
   */
  operator: PublicKey
  /** A solana connection */
  connection: Connection
}

/**
 * Create add operator instruction
 * @param param - Paramters for adding an operator
 * @returns An array of length 1 containt the add operator instruction
 */
export async function createAddOperatorInstruction(param: AddOperatorInstructionParam) {
  const { connection, signer, operator } = param
  const onchainProgram = await getOptimexProgram(connection)
  return [
    await onchainProgram.methods
      .addOrRemoveOperator(operator, true)
      .accounts({
        signer,
      })
      .instruction(),
  ]
}

/**
 * Parameter for removing operator
 */
export type RemoveOperatorInstructionParam = {
  /**
   * The signer authority who can manage operator
   * Must be the upgrade authority of the program
   */
  signer: PublicKey
  /**
   * The operator we want to remove
   */
  operator: PublicKey
  /** A solana connection */
  connection: Connection
}

/**
 * Create remove operator instruction
 * @param param - Paramters for adding an operator
 * @returns An array of length 1 containt the add operator instruction
 */
export async function createRemoveOperatorInstruction(param: RemoveOperatorInstructionParam) {
  const { connection, signer, operator } = param
  const onchainProgram = await getOptimexProgram(connection)
  return [
    await onchainProgram.methods
      .addOrRemoveOperator(operator, false)
      .accounts({
        signer,
      })
      .instruction(),
  ]
}
