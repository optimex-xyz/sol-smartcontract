import { Connection, PublicKey } from '@solana/web3.js'

import { getOptimexProgram } from '../artifacts'
import { getProgramData as getProgramDataPda } from '../pda/get_pda_address'

/**
 * Parameters for initializing the optimex program
 */
export type InitProgramInstructionParam = {
  /**
   * The signer authority who can initialize the optimex program, must be the upgrade authority of the program
   */
  signer: PublicKey
  /**
   * The admin of the protocol. If this is not none, the instruction will set the admin
   */
  admin: PublicKey | null
  /**
   * A solana connection
   */
  connection: Connection
}

/**
 * Create a group of instructions for initializing the program
 * @param signer - The user who initialize the program. This user must sign the transaction
 * @param connection - A solana connection
 * @returns An array of instructions for initializing the program
 */
export async function createInitializeProgramInstructions(param: InitProgramInstructionParam) {
  const { signer, connection, admin } = param
  const onchainProgram = getOptimexProgram(connection)
  const programData = getProgramDataPda()

  return [
    await onchainProgram.methods
      .init({ admin })
      .accounts({
        signer: signer,
        programData: programData,
      })
      .instruction(),
  ]
}
