import { AnchorProvider } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction } from '@solana/web3.js';
import { IToken } from '../solana-js/types/token_interface';
import { createMintToInstruction, getAssociatedTokenAddress, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createAssociatedTokenAccountInstructionIfNeeded } from '../solana-js';

export const createAccount = async ({
  provider,
  newAccountKeypair,
  lamports,
}: {
  provider: AnchorProvider;
  newAccountKeypair: Keypair;
  lamports: number;
}) => {
  const dataLength = 0;

  const rentExemptionAmount =
    await provider.connection.getMinimumBalanceForRentExemption(dataLength);

  const createAccountIns = SystemProgram.createAccount({
    fromPubkey: provider.wallet.publicKey,
    newAccountPubkey: newAccountKeypair.publicKey,
    lamports: rentExemptionAmount,
    space: dataLength,
    programId: SystemProgram.programId,
  });

  const transferIns = SystemProgram.transfer({
    fromPubkey: provider.wallet.publicKey,
    toPubkey: newAccountKeypair.publicKey,
    lamports: lamports,
  });

  const tx = new Transaction().add(createAccountIns).add(transferIns);

  await provider.sendAndConfirm(tx as any, [newAccountKeypair], {
    maxRetries: 20,
  });

  // console.log(
  //   `Create account ${newAccountKeypair.publicKey} with ${lamports} lamports: ${sig}`
  // );
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper functions
export function bigintToBytes32(value: bigint): number[] {
  // Convert to hex, pad to 64 chars (32 bytes) and remove 0x
  const hex = value.toString(16).padStart(64, '0');
  return Array.from(Buffer.from(hex, 'hex'));
}

export function createTokenPair(tokenAddr?: string): [IToken, IToken] {
  const toToken: IToken = {
    id: 1,
    networkId: 'ethereum-sepolia',
    tokenId: 'native',
    networkName: 'ethereum',
    networkSymbol: 'ETH',
    networkType: 'ETHEREUM',
    tokenName: 'USDT',
    tokenSymbol: 'USDT',
    tokenAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    tokenDecimals: 8,
    tokenLogoUri: '',
    networkLogoUri: '',
    createdAt: '',
    updatedAt: ''
  }
  let fromToken: IToken;
  if (tokenAddr) {
    fromToken = {
      id: 0,
      networkId: 'solana-devnet',
      tokenId: tokenAddr,
      networkName: 'solana',
      networkSymbol: 'solana',
      networkType: 'Solana',
      tokenName: 'test',
      tokenSymbol: 'TEST',
      tokenAddress: tokenAddr,
      tokenDecimals: 9,
      tokenLogoUri: '',
      networkLogoUri: '',
      createdAt: '',
      updatedAt: ''
    }
  } else {
    fromToken = {
      id: 0,
      networkId: 'solana-devnet',
      tokenId: 'native',
      networkName: 'solana',
      networkSymbol: 'solana',
      networkType: 'SOLANA',
      tokenName: 'native',
      tokenSymbol: 'SOL',
      tokenAddress: 'native',
      tokenDecimals: 9,
      tokenLogoUri: '',
      networkLogoUri: '',
      createdAt: '',
      updatedAt: ''
    }

  }
  return [fromToken, toToken];
}

export async function airdropTokenToUser(connection: Connection, mint: PublicKey, mintAuthority: Keypair, user: PublicKey, amount: number) {
  const associatedTokenAddress = getAssociatedTokenAddressSync(mint, user, true);

  const createUserAtaInstruction = await createAssociatedTokenAccountInstructionIfNeeded(
    connection,
    mintAuthority.publicKey,
    mint,
    user,
    'confirmed',
  )

  const mintToUserInstruction = await createMintToInstruction(
    mint,
    associatedTokenAddress,
    mintAuthority.publicKey,
    amount,
  );

  const transaction = new Transaction().add(...createUserAtaInstruction, mintToUserInstruction);
  await sendAndConfirmTransaction(connection, transaction, [mintAuthority], { commitment: 'confirmed' });
}

export async function getTokenBalance(connection: Connection, tokenMint: PublicKey, user: PublicKey) {
  const userTokenAta = await getAssociatedTokenAddress(tokenMint, user, true);
  try {
    const balance = await connection.getTokenAccountBalance(userTokenAta, 'confirmed');
    return Number(balance.value.amount);
  } catch (error) {
    if (error.toString().includes('could not find account')) {
      return 0;
    }
    throw error
  }
}

export async function getBlockTime(connection: Connection) {
  const slot = await connection.getSlot({ commitment: 'confirmed' });
  const blockTime = await connection.getBlockTime(slot);
  return blockTime;
}
