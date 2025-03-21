import {
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';

import { getKeypairFromFile } from '../utils/helper';
import path from 'path';
import { sha256 } from 'ethers';
import { createPaymentAndRefundAtaAndProtocolAtaIfNeededInstructions } from "optimex-solana-js";
import { getBlockTime } from '../utils/helper';

(async () => {
  const connection = new Connection(clusterApiUrl('devnet'));
  const currentDir = __dirname;
  const user = await getKeypairFromFile(path.join(currentDir, '../../.wallets/user.json'));
  const pmm = await getKeypairFromFile(path.join(currentDir, '../../.wallets/pmm.json'));
  
  function generateRandomBinaryString(length: number): string {
    return Array.from(
      { length }, 
      () => Math.random() < 0.5 ? '0' : '1'
    ).join('');
  }
  
  const tradeId = sha256('0x' + generateRandomBinaryString(20));
  console.log(`Trade ID: ${tradeId}`);
  const amount = 0.1 * LAMPORTS_PER_SOL;
  const feeAmount = 0.0001 * LAMPORTS_PER_SOL;

  const deadline = await getBlockTime(connection) + 3000;

  const paymentInstructions = await createPaymentAndRefundAtaAndProtocolAtaIfNeededInstructions({
    fromUser: user.publicKey,
    toUser: pmm.publicKey,
    tradeId,
    token: null,
    amount: amount,
    totalFee: feeAmount,
    deadline,
    connection: connection
  });

  const transaction = new Transaction().add(...paymentInstructions);
  const txHash = await sendAndConfirmTransaction(connection, transaction, [user], { commitment: 'confirmed' });
  console.log(`Payment success at tx Hash: ${txHash}`);
})()
