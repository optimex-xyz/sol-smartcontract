import { AccountMeta, Connection, PublicKey } from "@solana/web3.js";
import { getProtocolPda, getTradeVaultPda, getUserTradeDetailPda } from "../pda/get_pda_address";
import { getPetaFiProgram as getPetaFiProgram } from "../artifacts";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createAssociatedTokenAccountInstructionIfNeeded } from "./helpers";
import { bigintToBytes32 } from "../utils/parse_utils";
import { getTradeDetailData } from "../pda/get_pda_data";

/**
 * Parameters for creating a claim instructions
 */
export type ClaimInstructionParam = {
    /** The tradeId of the trade that we are claiming */
    tradeId: string,
    /** A solana connection */
    connection: Connection,
    /** The user pubkey who is performing the claim, this user must sign the transaction too */
    userPubkey: PublicKey,
}

/**
 * Create group of instructions for claiming a trade,
 *  will create a refund ata and protocol ATA if needed
 * @param params - Parameters for creating a claim instructions,
 * 
 * @returns An array of instructions for claiming a trade, including creating refund ata and protocol ata if needed
 */
export async function createClaimAndRefundAtaAndProtocolAtaIfNeededInstructions(params: ClaimInstructionParam) {
    const { tradeId, connection, userPubkey } = params;

    const petaFiProgram = await getPetaFiProgram(connection);
    const userTradeDetail = getUserTradeDetailPda(tradeId);
    const userTradeDetailData = await getTradeDetailData(tradeId, connection);
    const refundPubkey = userTradeDetailData.refundPubkey;
    const protocolPda = getProtocolPda();
    const tokenPubkey = userTradeDetailData.token;
    const remaminingAcocunts: AccountMeta[] = [];
    const tradeVaultPda = getTradeVaultPda(tradeId);
    if (tokenPubkey) {
        // SPL token
        // const vaultPda = await getVaultPda();
        const vaultAta = await getAssociatedTokenAddress(tokenPubkey, tradeVaultPda, true);
        const refundAta = await getAssociatedTokenAddress(tokenPubkey, refundPubkey, true);
        const protocolAta = await getAssociatedTokenAddress(tokenPubkey, protocolPda, true);
        remaminingAcocunts.push({
            pubkey: TOKEN_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
        },
        { pubkey: tokenPubkey, isSigner: false, isWritable: false },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: refundAta, isSigner: false, isWritable: true },
        { pubkey: protocolAta, isSigner: false, isWritable: true },
    );
    }
    const tradeIdBytes = bigintToBytes32(BigInt(tradeId));
    const claimIns = await petaFiProgram.methods.claim({
        tradeId: tradeIdBytes,
    })
        .accounts({
            signer: userPubkey,
            userTradeDetail,
            refundAccount: refundPubkey,
            userAccount: userTradeDetailData.userPubkey,
            vault: tradeVaultPda,
        })
        .remainingAccounts(remaminingAcocunts)
        .instruction();

    const createRefundAtaIns = await createAssociatedTokenAccountInstructionIfNeeded(connection, userPubkey, tokenPubkey, refundPubkey);
    const createProtocolAtaIns = await createAssociatedTokenAccountInstructionIfNeeded(connection, userPubkey, tokenPubkey, protocolPda);

    return [...createRefundAtaIns, ...createProtocolAtaIns, claimIns];
}