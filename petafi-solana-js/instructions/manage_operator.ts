import { Connection } from "@solana/web3.js"
import { PublicKey } from "@solana/web3.js"
import { getPetaFiProgram } from "../artifacts";

/**
 * Parameter for adding operator
 */
export type AddOperatorInstructionParam = {
    /** 
     * The signer authority who can manage operator
     * Must be the upgrade authority of the program
    */
    signer: PublicKey,
    /**
     * The operator we want to add
     */
    operator: PublicKey,
    /** A solana connection */
    connection: Connection,
}

/**
 * Create add operator instruction
 * @param param - Paramters for adding an operator
 * @returns An array of length 1 containt the add operator instruction
 */
export async function createAddOperatorInstruction(param: AddOperatorInstructionParam) {
    const { connection, signer, operator } = param;
    const petafiProgram = await getPetaFiProgram(connection);
    return [
        await petafiProgram.methods
        .addOrRemoveOperator(operator, true)
        .accounts({
            signer,
        })
        .instruction()
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
    signer: PublicKey,
    /**
     * The operator we want to remove
     */
    operator: PublicKey,
    /** A solana connection */
    connection: Connection,
}

/**
 * Create remove operator instruction
 * @param param - Paramters for adding an operator
 * @returns An array of length 1 containt the add operator instruction
 */
export async function createRemoveOperatorInstruction(param: RemoveOperatorInstructionParam) {
    const { connection, signer, operator } = param;
    const petafiProgram = await getPetaFiProgram(connection);
    return [
        await petafiProgram.methods
        .addOrRemoveOperator(operator, false)
        .accounts({
            signer,
        })
        .instruction()
    ]
}