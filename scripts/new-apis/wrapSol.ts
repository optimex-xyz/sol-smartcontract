import {
  clusterApiUrl,
  Connection,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { getKeypairFromFile } from '../utils/helper';
import path from 'path';

export async function wrapSol({
  signer,
  amount,
  receiver,
  connection,
}: {
  signer: PublicKey;
  amount: string;
  receiver: PublicKey;
  connection: Connection;
}) {
  const instructions = [];

  // Get the associated token account for the signer
  const wrappedSOLAddr = new PublicKey(
    'So11111111111111111111111111111111111111112'
  );
  const account = getAssociatedTokenAddressSync(wrappedSOLAddr, receiver);
  const accountInfo = await connection.getAccountInfo(account);

  // Create the associated token account if it doesn't exist
  if (!accountInfo)
    instructions.push(
      createAssociatedTokenAccountInstruction(
        signer,
        account,
        receiver,
        wrappedSOLAddr
      )
    );

  // Transfer native SOL to the token account to wrap it into wSOL
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: signer,
      toPubkey: account,
      lamports: BigInt(amount),
    })
  );
  instructions.push(createSyncNativeInstruction(account));

  const tx = new Transaction().add(...instructions);
  tx.feePayer = signer;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  return tx;
}

(async () => {
  const connection = new Connection(clusterApiUrl('devnet'));
  const currentDir = __dirname;
  // The user want to wrap SOL
  const user = await getKeypairFromFile(path.join(currentDir, '../../.wallets/deployer.json'));
  // 1 SOL to wrap
  const amount = '90000000000';
  const tx = await wrapSol({
    signer: user.publicKey,
    receiver: new PublicKey('BuGWUha7mFXFQYpWtWenMnseL452vLUoYXXVWPZEuK3Q'),
    amount,
    connection,
  });

  const txHash = await sendAndConfirmTransaction(connection, tx, [user], { commitment: 'confirmed' });
  console.log(`txHash: ${txHash}`);
})()