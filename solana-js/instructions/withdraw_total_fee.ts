import { AccountMeta, Commitment, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { getOptimexProgram } from "../artifacts";
import { getProtocolPda  } from "../pda/get_pda_address";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
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
     * The amount to withdraw, with decimals
     * If the amount is null, the fee will be withdrawn all available.
    */
    amount: bigint | number | null,
    /**
     * The commitment level, default is confirmed
     */
    commitment?: Commitment,
}

/**
 * Create a group of instructions for withdrawing the total fee
 * @param params - Parameters for creating a withdraw total fee instruction
 * @returns An array of instructions for withdrawing the total fee
 */
export async function createWithdrawTotalFeeInstruction(params: WithdrawTotalFeeInstructionParam): Promise<TransactionInstruction[]> {
    // Anysigner can perform this action.
    // Receiver pubkey is set by the admin already.
    const { connection, token, amount, receiverPubkey, signer, commitment } = params;
    const commitmentLevel = commitment || 'confirmed';
    let withdrawAmount: bigint;
    const protocolPda = getProtocolPda();
    const vaultBalance = await getTokenBalance(connection, token, protocolPda);
    const rent0Fee = BigInt(await connection.getMinimumBalanceForRentExemption(0, commitmentLevel));
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
            withdrawAmount = BigInt(amount);
            if (withdrawAmount > vaultBalance) {
                throw new InvalidParamError('Withdraw amount is greater than the available balance', {
                    withdrawAmount: withdrawAmount.toString(),
                    vaultBalance: vaultBalance.toString(),
                    token: token.toBase58(),
                });
            }
        } else {
            withdrawAmount = BigInt(amount);
            if (withdrawAmount > vaultBalance - rent0Fee) {
                throw new InvalidParamError('Withdraw amount is greater than the available balance', {
                    withdrawAmount: withdrawAmount.toString(),
                    vaultBalance: vaultBalance.toString(),
                    token: null,
                });
            }
        }
    }
    const onchainProgram = await getOptimexProgram(connection);
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

    const withdrawTotalFeeIns = await onchainProgram.methods.withdrawTotalFee({
        token,
        amount: new BN(withdrawAmount.toString()),
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
