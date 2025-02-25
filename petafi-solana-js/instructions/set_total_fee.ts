import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getPetaFiProgram } from "../artifacts";
import { BN } from "@coral-xyz/anchor";
import { getUserTradeDetailPda } from "../pda/get_pda_address";
import { getMint } from "@solana/spl-token";
import { bigintToBytes32 } from "../utils/parse_utils";
import { getTradeDetailData } from "../pda/get_pda_data";

/**
 * Parameters for creating a set protocol fee instructions
 */
export type SetTotalFeeInstructionParam = {
    /** The tradeId of the trade */
    tradeId: string;
    /** The amount of the fee, without decimals */
    amount: string,
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
    const petafiProgram = await getPetaFiProgram(connection);
    const tradeIdBytes = bigintToBytes32(BigInt(tradeId));

    const userTradeDetail = getUserTradeDetailPda(tradeId);
    const userTradeDetailData = await getTradeDetailData(tradeId, connection); 
    const tokenMint = userTradeDetailData.token;
    let feeAmount: BN;
    if (tokenMint) {
        const tokenData = await getMint(connection, tokenMint, 'confirmed');
        feeAmount = new BN(Number(amount) * 10**tokenData.decimals);
    }   
    else {
        // is SOL
        feeAmount = new BN(Number(amount) * LAMPORTS_PER_SOL);
    }

    const setProtocolFeeInstruction = await petafiProgram.methods
        .setTotalFee({
            tradeId: tradeIdBytes,
            amount: feeAmount,
        })
        .accounts({
            signer: mpcPubkey,
            userTradeDetail,
        })
        .instruction();

    return [setProtocolFeeInstruction];
}