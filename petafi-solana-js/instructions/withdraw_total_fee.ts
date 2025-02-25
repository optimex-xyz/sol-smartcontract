import { AccountMeta, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { getPetaFiProgram } from "../artifacts";
import { getProtocolPda  } from "../pda/get_pda_address";
import { getAssociatedTokenAddress, getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BN } from '@coral-xyz/anchor';
import { createAssociatedTokenAccountInstructionIfNeeded, getTokenBalance } from "./helpers";
import { InvalidParamError } from "../errors";

/**
 * Parameters for creating a withdraw total fee instruction
 */
export type WithdrawTotalFeeInstructionParam = {
    /** A solana connection */
    connection: Connection,
    /**
     * The signer account who perform the withdraw total fee
     * Can be anyone, must sign the transaction
    */
    signer: PublicKey,
    /**
     * The token pubkey of the fee,
     * If the token is null, the fee will be withdrawn in SOL.
    */
    token: PublicKey | null,
    /**
     * The receiver pubkey, must be config via admin.
    */
    receiverPubkey: PublicKey,
    /**
     * The amount to withdraw, without decmials,
     * If the amount is null, the fee will be withdrawn all available.
    */
    amount: string | null,
}

/**
 * Create a group of instructions for withdrawing the total fee
 * @param params - Parameters for creating a withdraw total fee instruction
 * @returns An array of instructions for withdrawing the total fee
 */
export async function createWithdrawTotalFeeInstruction(params: WithdrawTotalFeeInstructionParam): Promise<TransactionInstruction[]> {
    // Anysigner can perform this action.
    // Receiver pubkey is set by the admin already.
    const { connection, token, amount, receiverPubkey, signer } = params;
    let withdrawAmount: number;
    const protocolPda = getProtocolPda();
    const vaultBalance = await getTokenBalance(connection, token, protocolPda);
    const rent0Fee = await connection.getMinimumBalanceForRentExemption(0, 'confirmed');
    if (amount === null) { // if amount is null, withdraw max available
        if (token) {
            // If token, claim all available
            withdrawAmount = vaultBalance;
        } else {
            // If SOL, ensure the amount is enough to cover rent fee,
            withdrawAmount = vaultBalance - rent0Fee;
        }
    } else { //if not null, withdraw a specific amount
        if (token) {
            const mintDecimals = await getMint(connection, token, 'confirmed');
            withdrawAmount = Number(amount) * 10 ** mintDecimals.decimals;
            if (withdrawAmount > vaultBalance) {
                throw new InvalidParamError('Withdraw amount is greater than the available balance', {
                    withdrawAmount,
                    vaultBalance,
                    token: token.toBase58(),
                });
            }
        } else {
            withdrawAmount = Number(amount) * 10**9;
            if (withdrawAmount > vaultBalance - rent0Fee) {
                throw new InvalidParamError('Withdraw amount is greater than the available balance', {
                    withdrawAmount,
                    vaultBalance,
                    token: null,
                });
            }
        }
    }
    const petaFiProgram = await getPetaFiProgram(connection);
    const remainingAccounts: AccountMeta[] = [];
    if (token) {
        const protocolAta = await getAssociatedTokenAddress(token, protocolPda, true);
        const receiverAta = await getAssociatedTokenAddress(token, receiverPubkey, true);
        remainingAccounts.push({
            pubkey: TOKEN_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
        });
        remainingAccounts.push({
            pubkey: token,
            isSigner: false,
            isWritable: false,
        });
        remainingAccounts.push({ pubkey: protocolAta, isSigner: false, isWritable: true });
        remainingAccounts.push({ pubkey: receiverAta, isSigner: false, isWritable: true });
    }

    const withdrawTotalFeeIns = await petaFiProgram.methods.withdrawTotalFee({
        token,
        amount: new BN(withdrawAmount),
    })
        .accounts({
            signer: signer,
            toUser: receiverPubkey,
        }).remainingAccounts(remainingAccounts).instruction();
    return [withdrawTotalFeeIns];
}

/**
 * Create a group of instructions for creating receiver Ata if needed and withdrawing the total fee
 * @param params - Parameters for creating a withdraw total fee instruction
 * @returns An array of instructions for creating receiver Ata if needed and withdrawing the total fee
 */
export async function createReceiverAtaIfNeededAndWithdrawTotalFeeInstruction(params: WithdrawTotalFeeInstructionParam): Promise<TransactionInstruction[]> {
    const { connection, token, receiverPubkey, signer } = params;
    const createFeeReceiverAtaIns = await createAssociatedTokenAccountInstructionIfNeeded(connection, signer, token, receiverPubkey);
    const withdrawTotalFeeIns = await createWithdrawTotalFeeInstruction(params);
    return [...createFeeReceiverAtaIns, ...withdrawTotalFeeIns];
}
