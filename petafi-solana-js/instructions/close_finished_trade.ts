import { Connection, PublicKey } from "@solana/web3.js";
import { getTradeVaultPda, getUserTradeDetailPda } from "../pda/get_pda_address";
import { getPetaFiProgram as getPetaFiProgram } from "../artifacts";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { bigintToBytes32 } from "../utils/parse_utils";
import { getTradeDetailData } from "../pda/get_pda_data";

/**
 * Parameters for creating a claim instructions
 */
export type CloseFinishedTradeInstructionParam = {
    /** The tradeId of the trade that want to close to claim rent-fee */
    tradeId: string,
    /** A solana connection */
    connection: Connection,
    /** The user pubkey who is performing the closing, this user must sign the transaction too */
    userPubkey: PublicKey,
}

/**
 * Create group of instructions for closing a finished trade
 * @param params - Parameters for creating a close finished trade instructions,
 * 
 * @returns An array of instructions for closing a finished trade
 */
export async function createCloseFinishedTradeInstructions(params: CloseFinishedTradeInstructionParam) {
    const { tradeId, connection, userPubkey } = params;

    const petaFiProgram = await getPetaFiProgram(connection);
    const userTradeDetail = getUserTradeDetailPda(tradeId);
    const userTradeDetailData = await getTradeDetailData(tradeId, connection);
    const tokenPubkey = userTradeDetailData.token;
    const tradeVaultPda = getTradeVaultPda(tradeId);
    const tradeIdBytes = bigintToBytes32(BigInt(tradeId));
    const closeIns = await petaFiProgram.methods.closeFinishedTrade({
        tradeId: tradeIdBytes,
    })
        .accounts({
            signer: userPubkey,
            userTradeDetail,
            userAccount: userTradeDetailData.userPubkey,
            vault: tradeVaultPda,
            vaultTokenAccount: tokenPubkey ? await getAssociatedTokenAddress(tokenPubkey, tradeVaultPda, true) : null,
        })
        .instruction();

    return [closeIns];
}