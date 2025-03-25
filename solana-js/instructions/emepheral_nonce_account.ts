import { Commitment, Connection, NONCE_ACCOUNT_LENGTH, PublicKey, SystemProgram } from '@solana/web3.js'

/**
 * Create a group of instructions for creating a nonce account and initialize it for durable transaction
 * @param userPubkey - The user who pay the rent for the nonce account. This user must sign the transaction
 * @param userEphemeralPubkey - The pubkey for the nonce account. This account must sign the transaction
 * @param authorityKey - The authority key for the nonce account, who can advance nonce and perform durable transaction
 * @param connection - A solana connection
 * @returns An array of instructions for creating a nonce account, and initialize it
 */
export async function createEphemeralNonceAccountInstruction({
  userPubkey,
  userEphemeralPubkey,
  authorityKey,
  connection,
  commitment,
}: {
  userPubkey: PublicKey
  userEphemeralPubkey: PublicKey
  authorityKey: PublicKey
  connection: Connection
  commitment?: Commitment
}) {
  const commitmentLevel = commitment || 'confirmed'
  const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH, commitmentLevel)
  return [
    SystemProgram.createAccount({
      fromPubkey: userPubkey,
      newAccountPubkey: userEphemeralPubkey,
      lamports: rentExemptBalance,
      space: NONCE_ACCOUNT_LENGTH,
      programId: SystemProgram.programId,
    }),
    SystemProgram.nonceInitialize({
      noncePubkey: userEphemeralPubkey,
      authorizedPubkey: authorityKey,
    }),
  ]
}
