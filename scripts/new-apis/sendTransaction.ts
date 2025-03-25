import {
  Connection,
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

export async function createAndSendTransactionWithKeypair({
  connection,
  instructions,
  payer,
  skipPreflight = false,
}: {
  instructions: TransactionInstruction[];
  connection: Connection;
  payer: Keypair;
  skipPreflight?: boolean;
}) {
  const blockhash = await connection.getLatestBlockhashAndContext('confirmed');

  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash.value.blockhash,
    instructions: [...instructions],
  }).compileToV0Message();

  const transactionV0 = new VersionedTransaction(messageV0);

  transactionV0.sign([payer]);

  const blockHeight = await connection.getBlockHeight({
    commitment: 'confirmed',
    minContextSlot: blockhash.context.slot,
  });

  const transactionTTL = blockHeight + 151;
  const waitToConfirm = () =>
    new Promise((resolve) => setTimeout(resolve, 5000));
  const waitToRetry = () => new Promise((resolve) => setTimeout(resolve, 2000));

  const numTry = 30;

  for (let i = 0; i < numTry; i++) {
    // check transaction TTL
    const blockHeight = await connection.getBlockHeight('confirmed');
    if (blockHeight >= transactionTTL) {
      throw new Error('ONCHAIN_TIMEOUT');
    }

    await connection.simulateTransaction(transactionV0, {
      replaceRecentBlockhash: true,
      commitment: 'confirmed',
    });

    const siganture = await connection?.sendRawTransaction(
      transactionV0.serialize(),
      {
        skipPreflight: skipPreflight,
        maxRetries: 0,
        preflightCommitment: 'confirmed',
      }
    );

    await waitToConfirm();

    const sigStatus = await connection.getSignatureStatus(siganture);

    if (sigStatus.value?.err) {
      throw new Error('UNKNOWN_TRANSACTION');
    }

    if (sigStatus.value?.confirmationStatus === 'confirmed') {
      break;
    }

    await waitToRetry();
  }
}
