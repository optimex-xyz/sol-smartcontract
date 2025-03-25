import { BN } from '@coral-xyz/anchor'
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { AccountMeta, Commitment, Connection, PublicKey, TransactionInstruction } from '@solana/web3.js'

import { createEphemeralNonceAccountInstruction } from './emepheral_nonce_account'

import { getOptimexProgram } from '../artifacts'
import { WSOL_MINT } from '../constants'
import { getTradeVaultPda, getUserTradeDetailPda, getWhitelistPda } from '../pda/get_pda_address'
import { IToken } from '../types/token_interface'
import { TradeDetailInput } from '../types/trade_info'
import { getTradeInput } from '../utils/param_utils'
import { bigintToBytes32 } from '../utils/parse_utils'

/** Parameters for creating a deposit instructions */
export interface DepositInstructionParam {
  /** The session ID of the trade */
  sessionId: bigint
  /** The user pubkey who is performing the deposit
   * This user must sign the transaction */
  userPubkey: PublicKey
  /** The MPC pubkey who is performing the settlement when the trade success */
  mpcPubkey: PublicKey
  /**
   * The user ephemeral pubkey,
   * This is used to presign the settlement transaction, and create a nonce account for the user
   * This account must sign the transaction
   */
  userEphemeralPubkey: PublicKey
  /** The amount of the deposit, with decimals */
  amount: bigint
  /** A solana connection */
  connection: Connection
  /** The timeout for the trade, after the timeout, user can claim the deposited amount */
  scriptTimeout: number
  /** The token information that we are depositing */
  fromToken: IToken
  /** The token information that we want to receive */
  toToken: IToken
  /** The user address that we want to receive the toToken */
  toUserAddress: string
  /** The solver address that resolve the trade */
  solver: string
  /** The refund pubkey, this is the address that will receive the token if the trade fails */
  refundPubkey: PublicKey
  /** The commitment level, default is confirmed */
  commitment?: Commitment
}

/**
 * Create a group of instructions for depositing a trade,
 * Create a durable nonce account for settlement
 * Will create a vault ata if needed
 * @param params - Parameters for creating a group of deposit, initialize vault, and create durable nonce account
 * @returns An array of instructions for depositing a trade
 */
export async function createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(params: DepositInstructionParam) {
  const { userPubkey, connection, fromToken, userEphemeralPubkey, mpcPubkey, commitment } = params
  const commitmentLevel = commitment || 'confirmed'
  const isNativeToken = fromToken.tokenAddress === 'native' ? true : false
  const depositInstruction = await createDepositInstruction(params)
  let instructions: TransactionInstruction[] = []

  const createNonceAccountInstruction = await createEphemeralNonceAccountInstruction({
    userPubkey,
    userEphemeralPubkey: userEphemeralPubkey,
    authorityKey: mpcPubkey,
    connection,
  })

  if (!isNativeToken) {
    const depositToken = new PublicKey(fromToken.tokenAddress)

    const { tradeId } = await getTradeInput(params)

    const vaultPda = getTradeVaultPda(tradeId)
    const vaultAta = getAssociatedTokenAddressSync(depositToken, vaultPda, true)
    const vaultAtaInfo = await connection.getAccountInfo(vaultAta, commitmentLevel)
    if (!vaultAtaInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          userPubkey, // payer
          vaultAta, // ATA for vault
          vaultPda, //  owner of the `vaultAta`
          depositToken // token
        )
      )
    }
  }

  instructions = instructions.concat(depositInstruction)
  instructions = instructions.concat(createNonceAccountInstruction)

  return instructions
}

/**
 * Create deposit instruction for depositing a trade
 * @param params - Parameters for creating a deposit instruction
 * @returns An instruction for depositing a trade
 * @note This instruction does not check whether the ata is created
 */
export async function createDepositInstruction(params: DepositInstructionParam) {
  const { userPubkey, mpcPubkey, userEphemeralPubkey, connection, scriptTimeout, fromToken, refundPubkey } = params
  const onchainProgram = await getOptimexProgram(connection)

  const isNativeToken = fromToken.tokenAddress === 'native' ? true : false

  const { tradeInput, tradeId } = await getTradeInput(params)

  const tradeDetail: TradeDetailInput = {
    timeout: new BN(scriptTimeout),
    mpcPubkey: mpcPubkey,
    refundPubkey: refundPubkey,
  }

  const userTradeDetail = getUserTradeDetailPda(tradeId)
  let depositRemainingAccounts: AccountMeta[] = []
  let whitelistToken = getWhitelistPda(WSOL_MINT)
  const tradeVaultPda = getTradeVaultPda(tradeId)

  if (!isNativeToken) {
    const tokenAddr = new PublicKey(fromToken.tokenAddress)
    whitelistToken = getWhitelistPda(tokenAddr)
    const userAta = getAssociatedTokenAddressSync(tokenAddr, userPubkey, true)
    const tradeVaultAta = getAssociatedTokenAddressSync(tokenAddr, tradeVaultPda, true)

    depositRemainingAccounts = [
      {
        pubkey: TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: tokenAddr, isSigner: false, isWritable: false },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: tradeVaultAta, isSigner: false, isWritable: true },
    ]
  }

  const tradeIdBytes = bigintToBytes32(BigInt(tradeId))

  return [
    await onchainProgram.methods
      .deposit({
        tradeId: tradeIdBytes,
        data: tradeDetail,
        input: tradeInput,
      })
      .accounts({
        signer: userPubkey,
        userTradeDetail: userTradeDetail,
        ephemeralAccount: userEphemeralPubkey,
        whitelistToken,
        vault: tradeVaultPda,
      })
      .remainingAccounts(depositRemainingAccounts)
      .instruction(),
  ]
}

/**
 * Create a group of instructions for depositing a trade
 * In deposit ins, we also create a durable nonce account for settlement
 * Will create a vault ata if needed
 * @param params - Parameters for creating a group of deposit, initialize vault, and create durable nonce account
 * @returns An array of instructions for depositing a trade
 */
export async function createDepositAndVaultAtaIfNeededInstructions(params: DepositInstructionParam) {
  const { userPubkey, connection, fromToken, commitment } = params
  const commitmentLevel = commitment || 'confirmed'
  const isNativeToken = fromToken.tokenAddress === 'native' ? true : false
  const depositInstruction = await createDepositInstruction(params)
  let instructions: TransactionInstruction[] = []

  if (!isNativeToken) {
    const { tradeId } = await getTradeInput(params)
    const tradeVaultPda = getTradeVaultPda(tradeId)
    const depositToken = new PublicKey(fromToken.tokenAddress)

    const tradeVaultAta = getAssociatedTokenAddressSync(depositToken, tradeVaultPda, true)
    const vaultAtaInfo = await connection.getAccountInfo(tradeVaultAta, commitmentLevel)
    if (!vaultAtaInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          userPubkey, // payer
          tradeVaultAta, // ATA for vault
          tradeVaultPda, //  owner of the `vaultAta`
          depositToken // token
        )
      )
    }
  }

  instructions = instructions.concat(depositInstruction)

  return instructions
}
