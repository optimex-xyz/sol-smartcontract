import { Connection, PublicKey } from "@solana/web3.js";
import { getOptimexProgram } from "../artifacts";
import { BN } from "@coral-xyz/anchor";
import { getUserTradeDetailPda } from "../pda/get_pda_address";
import { bigintToBytes32 } from "../utils/parse_utils";

/**
 * Parameters for creating a set protocol fee instructions
 */
export type SetTotalFeeInstructionParam = {
    /** The tradeId of the trade */
    tradeId: string;
    /** The amount of the fee, with decimals */
    amount: bigint | number,
    /** The mpc pubkey who set has the authority to set the protocol fee
     * This user must sign the transaction
     */
    mpcPubkey: PublicKey;
    /** A solana connection */
    connection: Connection;
}

/**
 * Create a group of instructions for setting the protocol fee
 * @param params - Parameters for creating a set protocol fee instructions
 * @returns An array of instructions for setting the protocol fee
 */
export async function createSetTotalFeeInstructions(params: SetTotalFeeInstructionParam) {
    const { tradeId, amount, mpcPubkey, connection } = params;
    const onchainProgram = await getOptimexProgram(connection);
    const tradeIdBytes = bigintToBytes32(BigInt(tradeId));

    const userTradeDetail = getUserTradeDetailPda(tradeId);
    const setProtocolFeeInstruction = await onchainProgram.methods
        .setTotalFee({
            tradeId: tradeIdBytes,
            amount: new BN(amount.toString()),
        })
        .accounts({
            signer: mpcPubkey,
            userTradeDetail,
        })
        .instruction();

    return [setProtocolFeeInstruction];
}