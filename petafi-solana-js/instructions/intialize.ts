import { Connection, PublicKey } from "@solana/web3.js";
import { getPetaFiProgram } from "../artifacts";
import { getProgramData as getProgramDataPda } from "../pda/get_pda_address";

/**
 * Parameters for initializing the petafi program
 */
export type InitPetaFiInstructionParam = {
    /**
     * The signer authority who can initialize the petafi program, must be the upgrade authority of the program
     */
    signer: PublicKey,
    /**
     * The admin of the protocol. If this is not none, the instruction will set the admin
     */
    admin: PublicKey | null,
    /**
     * A solana connection
     */
    connection: Connection,
}

/**
 * Create a group of instructions for initializing the petafi program
 * @param signer - The user who initialize the petafi program. This user must sign the transaction
 * @param connection - A solana connection
 * @returns An array of instructions for initializing the petafi program
 */
export async function createInitializePetaFiInstructions(param: InitPetaFiInstructionParam) {
    const { signer, connection, admin } = param;
    const petafiProgram = getPetaFiProgram(connection);
    const programData = getProgramDataPda();

    return [await petafiProgram.methods
        .init({ admin })
        .accounts({
            signer: signer,
            programData: programData,
        })
        .instruction()];
}