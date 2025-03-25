import { BN } from '@coral-xyz/anchor'
import { Connection, PublicKey } from '@solana/web3.js'

import { getOptimexProgram } from '../artifacts'
import { InvalidParamError } from '../errors'
import { getWhitelistPda } from '../pda'

/**
 * Parameter for adding or updating whitelist token
 */
export type AddOrUpdateWhitelistInstructionParam = {
  /**
   * The signer authority who can manage whitelist token
   * Must be one of the operator
   * Must sign the transaction
   */
  operator: PublicKey
  /** The token address the operator will whitelist */
  token: PublicKey
  /** The minimum amount needed for deposit, with decimals */
  amount: bigint
  /** A solana connection */
  connection: Connection
}

/**
 * Create add or update whitelist instruction
 * @param param - Paramters for adding or updating the whitelist token
 * @returns An array of length 1 containt the add or update whitelist token
 */
export async function createAddOrUpdateWhitelistInstruction(param: AddOrUpdateWhitelistInstructionParam) {
  const { connection, operator, token, amount } = param
  const onchainProgram = await getOptimexProgram(connection)
  return [
    await onchainProgram.methods
      .addOrUpdateWhitelist(new BN(amount.toString()))
      .accounts({
        operator,
        token,
      })
      .instruction(),
  ]
}

/**
 * Parameter for removing whitelist token
 */
export type RemoveWhitelistInstructionParam = {
  /**
   * The signer authority who can manage whitelist token
   * Must be the operator
   * Must sign the transaction
   */
  operator: PublicKey
  /** The token address the operator will remove from whitelist */
  token: PublicKey
  /** A solana connection */
  connection: Connection
}

/**
 * Create remove whitelist token instruction
 * @param param - Paramters for removing whitelist token
 * @returns An array of length 1 containt the remove whitelist token instruction
 */
export async function createRemoveWhitelistInstruction(param: RemoveWhitelistInstructionParam) {
  const { connection, operator, token } = param
  const onchainProgram = await getOptimexProgram(connection)
  const whitelistToken = getWhitelistPda(token)
  return [
    await onchainProgram.methods
      .removeWhitelist()
      .accounts({
        operator,
        whitelistToken,
        token,
      })
      .instruction(),
  ]
}

/**
 * Parameter for setting close wait duration, for both trade closement and payment closement
 */
export type SetCloseWaitDurationInstructionParam = {
  /**
   * The signer authority who can manage whitelist token
   * Must be the operator
   * Must sign the transaction
   */
  operator: PublicKey
  /** The duration in seconds for closing a trade */
  closeTradeDuration?: number
  /** The duration in seconds for closing a payment */
  closePaymentDuration?: number
  /** A solana connection */
  connection: Connection
}

/**
 * Create set close wait duration instruction
 * @param param - Parameters for setting close wait duration
 * @returns An array of length 1 containing the set close wait duration instruction
 */
export async function createSetCloseWaitDurationInstruction(param: SetCloseWaitDurationInstructionParam) {
  const { connection, operator, closeTradeDuration, closePaymentDuration } = param
  if (!closeTradeDuration && !closePaymentDuration) {
    throw new InvalidParamError('At least one duration required', {})
  }
  const onchainProgram = await getOptimexProgram(connection)
  return [
    await onchainProgram.methods
      .setCloseWaitDuration({
        closeTradeDuration: closeTradeDuration !== undefined ? new BN(closeTradeDuration) : null,
        closePaymentDuration: closePaymentDuration !== undefined ? new BN(closePaymentDuration) : null,
      })
      .accounts({
        operator,
      })
      .instruction(),
  ]
}

/**
 * Parameter for adding fee receiver instruction
 */
export type AddFeeReceiverInstructionParam = {
  /** A solana connection */
  connection: Connection
  /**
   * The signer authority who can add fee receiver
   * Must be the admin
   * Must sign the transaction
   */
  signer: PublicKey
  /** The fee receiver address */
  receiver: PublicKey
}

/**
 * Create add fee receiver instruction
 * @param param - Parameters for adding fee receiver
 * @returns An array of length 1 containing the add fee receiver instruction
 */
export async function createAddFeeReceiverInstruction(param: AddFeeReceiverInstructionParam) {
  const { connection, signer, receiver } = param
  const onchainProgram = await getOptimexProgram(connection)
  return [
    await onchainProgram.methods
      .addFeeReceiver(receiver)
      .accounts({
        signer,
      })
      .instruction(),
  ]
}

/**
 * Parameter for removing fee receiver instruction
 */
export type RemoveFeeReceiverInstructionParam = {
  /** A solana connection */
  connection: Connection
  /**
   * The signer authority who can remove fee receiver
   * Must be the admin
   * Must sign the transaction
   */
  signer: PublicKey
  /** The fee receiver address */
  receiver: PublicKey
}

/**
 * Create remove fee receiver instruction
 * @param param - Parameters for removing fee receiver
 * @returns An array of length 1 containing the remove fee receiver instruction
 */
export async function createRemoveFeeReceiverInstruction(param: RemoveFeeReceiverInstructionParam) {
  const { connection, signer, receiver } = param
  const onchainProgram = await getOptimexProgram(connection)
  return [
    await onchainProgram.methods
      .removeFeeReceiver(receiver)
      .accounts({
        signer,
      })
      .instruction(),
  ]
}
