import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PetaFiSolSmartcontract } from '../target/types/peta_fi_sol_smartcontract';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import { expect, assert } from 'chai';
import { airdropTokenToUser, createAccount, getTokenBalance, sleep } from './utils';
import { keccak256, sha256, toUtf8Bytes } from 'ethers';
import _ from 'lodash';
import {
  createMint,
} from '@solana/spl-token';
import { createPaymentAndRefundAtaAndProtocolAtaIfNeededInstructions } from '../petafi-solana-js/instructions/payment';
import { bigintToBytes32, delay, getBlockTime } from '../scripts/utils/helper';
import { createAddOperatorInstruction } from '../petafi-solana-js/instructions/manage_operator';
import { createAddOrUpdateWhitelistInstruction, createSetCloseWaitDurationInstruction } from '../petafi-solana-js/instructions/manage_config';
import { WSOL_MINT } from '../petafi-solana-js/constants';
import { getPaymentReceiptPda } from '../petafi-solana-js/pda/get_pda_address';
import { getPaymentReceiptAddresses, getPaymentReceiptData } from '../petafi-solana-js/pda/get_pda_data';
import { createClosePaymentReceiptInstructions } from '../petafi-solana-js/instructions/close_payment_receipt';

dotenv.config();

type TradeDetail = anchor.IdlTypes<PetaFiSolSmartcontract>['tradeDetail'];

describe('Payment() functional testing', () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace
    .PetaFiSolSmartcontract as Program<PetaFiSolSmartcontract>;

  const anchorProvider = program.provider as anchor.AnchorProvider;
  const connection = anchorProvider.connection;
  const deployer = (anchorProvider.wallet as anchor.Wallet).payer;
  const payer = Keypair.generate();
  const operator = Keypair.generate();
  const user = Keypair.generate();

  const [protocolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('protocol')],
    program.programId
  );

  describe('Setup program', async () => {
    it('Init program', async () => {
      const BPF_LOADER_PROGRAM = new PublicKey(
        'BPFLoaderUpgradeab1e11111111111111111111111'
      );

      const [programData] = PublicKey.findProgramAddressSync(
        [program.programId.toBuffer()],
        BPF_LOADER_PROGRAM
      );

      const tx = await program.methods
        .init({ admin: deployer.publicKey })
        .accounts({
          signer: deployer.publicKey,
          programData: programData,
        })
        .rpc({ commitment: 'confirmed' });

      await connection.requestAirdrop(payer.publicKey, 100 * LAMPORTS_PER_SOL);
      await connection.requestAirdrop(operator.publicKey, 100 * LAMPORTS_PER_SOL);
      await connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
      await delay(2000);
    });

    it('Add operator success', async () => {
      const instructions = await createAddOperatorInstruction({
        signer: deployer.publicKey,
        operator: operator.publicKey,
        connection: connection,
      });
      const transaction = new Transaction().add(...instructions);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
    })
    it('Add whitelist WSOL success', async () => {
      const instructions = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: WSOL_MINT,
        amount: '0.001',
        connection: connection,
      });
      const transaction = new Transaction().add(...instructions);
      try {
        await sendAndConfirmTransaction(connection, transaction, [operator], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
    })

    it('Set close wait duration', async () => {
      const instructions = await createSetCloseWaitDurationInstruction({
        operator: operator.publicKey,
        closePaymentDuration: 4,
        connection,
      });
      const transaction = new Transaction().add(...instructions);
      try {
        await sendAndConfirmTransaction(connection, transaction, [operator], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
    })

  })

  describe('Input validation', () => {
    it('Should fail when deadline is exceeded', async () => {
      const tradeId = sha256('0x11');
      const paymentIns = await createPaymentAndRefundAtaAndProtocolAtaIfNeededInstructions({
        fromUser: deployer.publicKey,
        toUser: Keypair.generate().publicKey,
        tradeId,
        token: null,
        amount: '1',
        totalFee: '0.1',
        deadline: 0,
        connection,
      });

      const transaction = new Transaction().add(...paymentIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer]);
        assert.fail('Transaction should fail');
      } catch (error) {
        expect(error.toString()).to.include('DeadlineExceeded');
      }
    });

    it('Should fail when amount is equal 0', async () => {
      const tradeId = sha256('0x11');
      const currentTime = await getBlockTime(connection);
      const paymentIns = await createPaymentAndRefundAtaAndProtocolAtaIfNeededInstructions({
        fromUser: deployer.publicKey,
        toUser: Keypair.generate().publicKey,
        tradeId,
        token: null,
        amount: '0',
        totalFee: '0',
        deadline: currentTime + 3000,
        connection,
      });

      const transaction = new Transaction().add(...paymentIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer]);
        assert.fail('Transaction should fail');
      } catch (error) {
        expect(error.toString()).to.include('InvalidAmount');
      }
    });

    it('Should fail when pFee is bigger than amount', async () => {
      const amount = 100;
      const pFee = 110;
      const tradeId = sha256('0x11');
      const currentTime = await getBlockTime(connection);

      const paymentIns = await createPaymentAndRefundAtaAndProtocolAtaIfNeededInstructions({
        fromUser: deployer.publicKey,
        toUser: Keypair.generate().publicKey,
        tradeId,
        token: null,
        amount: '100',
        totalFee: '110',
        deadline: currentTime + 3000,
        connection,
      });

      const transaction = new Transaction().add(...paymentIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer]);
        assert.fail('Transaction should fail');
      } catch (error) {
        expect(error.toString()).to.include('InvalidAmount');
      }
    });
  });

  describe('Payment with SOL', () => {
    const newAccount = Keypair.generate();
    it('Should succeed', async () => {
      const amount = '0.1';
      const pFee = '0.0001';

      // create another wallet (account)
      const tradeId = sha256('0x11');
      const currentTime = await getBlockTime(connection);


      const paymentIns = await createPaymentAndRefundAtaAndProtocolAtaIfNeededInstructions({
        fromUser: user.publicKey,
        toUser: newAccount.publicKey,
        tradeId,
        token: null,
        amount,
        totalFee: pFee,
        deadline: currentTime + 3000,
        connection,
      });

      const transaction = new Transaction().add(...paymentIns);
      transaction.feePayer = user.publicKey;
      const beforeFromUserBalance = await connection.getBalance(user.publicKey, 'confirmed');
      const beforeToUserBalance = await connection.getBalance(newAccount.publicKey, 'confirmed');
      const beforeProtocolBalance = await connection.getBalance(protocolPda, 'confirmed');
      let txTime: number;
      try {
        const sig = await sendAndConfirmTransaction(connection, transaction, [user], { commitment: 'confirmed' });
        const parsedTx = await connection.getParsedTransaction(sig, 'confirmed');
        txTime = parsedTx.blockTime;
      } catch (error) {
        console.log(error);
        throw error;
      }

      const paymentReceiptPda = getPaymentReceiptPda({
        fromUser: user.publicKey,
        toUser: newAccount.publicKey,
        tradeId,
        token: null,
        amount,
        protocolFee: pFee,
        tokenDecimals: 9,
      });
      const paymentReceiptBalance = await connection.getBalance(paymentReceiptPda, 'confirmed');
      const afterFromUserBalance = await connection.getBalance(user.publicKey, 'confirmed');
      const afterToUserBalance = await connection.getBalance(newAccount.publicKey, 'confirmed');
      const afterProtocolBalance = await connection.getBalance(protocolPda, 'confirmed');
      assert.equal(beforeFromUserBalance - afterFromUserBalance, Number(amount) * 10 ** 9 + paymentReceiptBalance, 'From user balance should be decreased');
      assert.equal(afterToUserBalance - beforeToUserBalance, (Number(amount) - Number(pFee)) * 10 ** 9, 'To user balance should be increased');
      assert.equal(afterProtocolBalance - beforeProtocolBalance, Number(pFee) * 10 ** 9, 'Protocol balance should be increased');

      const paymentReceiptData = await getPaymentReceiptData(paymentReceiptPda, connection);
      assert.equal(paymentReceiptData.fromPubkey.toBase58(), user.publicKey.toBase58(), 'From user should be the same');
      assert.equal(paymentReceiptData.toPubkey.toBase58(), newAccount.publicKey.toBase58(), 'To user should be the same');
      assert.equal(paymentReceiptData.tradeId.toString(), bigintToBytes32(BigInt(tradeId)).toString(), 'Trade id should be the same');
      assert.equal(paymentReceiptData.totalFee.toNumber(), Number(pFee) * 10 ** 9, 'Protocol fee should be the same');
      assert.equal(paymentReceiptData.paymentAmount.toNumber(), Number(amount) * 10 ** 9, 'Amount should be the same');
      assert.equal(paymentReceiptData.paymentTime.toNumber(), txTime, 'Payment time should be the same');
      assert.isNull(paymentReceiptData.token, 'Token should be null');
    });

    it('Should fail when do not have enough amount', async () => {
      const tradeId = sha256('0x11');
      const fromUser = Keypair.generate();
      const newAccount = Keypair.generate();
      const currentTime = await getBlockTime(connection);
      const paymentIns = await createPaymentAndRefundAtaAndProtocolAtaIfNeededInstructions({
        fromUser: fromUser.publicKey,
        toUser: newAccount.publicKey,
        tradeId,
        token: null,
        amount: '0.1',
        totalFee: '0.0001',
        deadline: currentTime + 3000,
        connection,
      });

      const tx = new Transaction().add(...paymentIns);
      tx.feePayer = payer.publicKey;
      try {
        await sendAndConfirmTransaction(connection, tx, [fromUser, payer], { commitment: 'confirmed' });
        assert.fail('Transaction should fail');
      } catch (error) {
        expect(error.toString()).to.include('custom program error: 0x1');
      }
    });

    it('Test get payment receipt method ', async () => {
      await sleep(1000);
      const allReceipts = await program.account.paymentReceipt.all();
      const recepts = await getPaymentReceiptAddresses(connection, {});
      assert.equal(recepts.length, allReceipts.length, 'Receipts should be the same');
      for (const [index, receipt] of allReceipts.entries()) {
        assert.equal(allReceipts[index].publicKey.toBase58(), receipt.publicKey.toBase58(), 'Receipts should be the same');
      }
      const receiptsWithTradeId = await getPaymentReceiptAddresses(connection, { tradeId: sha256('0x11') });
      assert.equal(receiptsWithTradeId.length, 1, 'Should have 1 receipt with trade id');
      assert.equal(receiptsWithTradeId[0].publicKey.toBase58(), allReceipts[0].publicKey.toBase58(), 'Receipts should be the same');

      const receiptsWithFakeTradeId = await getPaymentReceiptAddresses(connection, { tradeId: sha256('0x12') });
      assert.equal(receiptsWithFakeTradeId.length, 0, 'Should not have receipt with fake trade id');

      const receiptsWithFromUser = await getPaymentReceiptAddresses(connection, { fromUser: user.publicKey });
      assert.equal(receiptsWithFromUser.length, 1, 'Should have 1 receipt with from user');
      assert.equal(receiptsWithFromUser[0].publicKey.toBase58(), allReceipts[0].publicKey.toBase58(), 'Receipts should be the same');

      const receiptsWithFakeFromUser = await getPaymentReceiptAddresses(connection, { fromUser: Keypair.generate().publicKey });
      assert.equal(receiptsWithFakeFromUser.length, 0, 'Should not have receipt with fake from user');

      const receiptsWithToUser = await getPaymentReceiptAddresses(connection, { toUser: newAccount.publicKey });
      assert.equal(receiptsWithToUser.length, 1, 'Should have 1 receipt with to user');
      assert.equal(receiptsWithToUser[0].publicKey.toBase58(), allReceipts[0].publicKey.toBase58(), 'Receipts should be the same');

      const receiptsWithFakeToUser = await getPaymentReceiptAddresses(connection, { toUser: Keypair.generate().publicKey });
      assert.equal(receiptsWithFakeToUser.length, 0, 'Should not have receipt with fake to user');

      const receiptWithAllFilter = await getPaymentReceiptAddresses(connection, { tradeId: sha256('0x11'), fromUser: user.publicKey, toUser: newAccount.publicKey });
      assert.equal(receiptWithAllFilter.length, 1, 'Should have 1 receipt with all filter');
      assert.equal(receiptWithAllFilter[0].publicKey.toBase58(), allReceipts[0].publicKey.toBase58(), 'Receipts should be the same');
    })

    it('Should fail when close payment receipt when not closable', async () => {
      const tradeId = sha256('0x11');
      const paymentReceiptPda = (await getPaymentReceiptAddresses(connection, { tradeId }))[0];
      const closePaymentReceiptIns = await createClosePaymentReceiptInstructions({
        paymentReceipt: paymentReceiptPda.publicKey,
        connection,
      });
      const transaction = new Transaction().add(...closePaymentReceiptIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        // console.log(error);
        assert.isTrue(error.toString().includes('CloseNotAvailable'));
      }
    })

    it('Should fail when close payment receipt unauthorized', async () => {
      const tradeId = sha256('0x11');
      const paymentReceiptPda = (await getPaymentReceiptAddresses(connection, { tradeId }))[0];
      const closePaymentReceiptIns = await createClosePaymentReceiptInstructions({
        paymentReceipt: paymentReceiptPda.publicKey,
        connection,
      });
      const transaction = new Transaction().add(...closePaymentReceiptIns);
      try {
        await program.methods.closePaymentReceipt()
        .accounts({
          signer: operator.publicKey,
          paymentReceipt: paymentReceiptPda.publicKey,
        }).signers([operator])
        .rpc({ commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        assert.isTrue(error.toString().includes('InvalidUserAccount'));
      }
    })

    it('Should close payment receipt success', async () => {
      const tradeId = sha256('0x11');
      await sleep(6000);
      const paymentReceiptPda = (await getPaymentReceiptAddresses(connection, { tradeId }))[0];
      const paymentReceiptData = await getPaymentReceiptData(paymentReceiptPda.publicKey, connection);
      const beforeUserBalance = await connection.getBalance(paymentReceiptData.fromPubkey, 'confirmed');
      const paymentReceiptBalance = await connection.getBalance(paymentReceiptPda.publicKey, 'confirmed');
      const closePaymentReceiptIns = await createClosePaymentReceiptInstructions({
        paymentReceipt: paymentReceiptPda.publicKey,
        connection,
      });
      const transaction = new Transaction().add(...closePaymentReceiptIns);
      transaction.feePayer = deployer.publicKey;
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer, user], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const paymentReceiptInfo = await connection.getAccountInfo(paymentReceiptPda.publicKey);
      assert.isNull(paymentReceiptInfo, 'Payment receipt should be closed');
      const afterUserBalance = await connection.getBalance(paymentReceiptData.fromPubkey, 'confirmed');
      assert.equal(afterUserBalance - beforeUserBalance, paymentReceiptBalance, 'User balance should be incresed by the amount of payment receipt');
    })
  });

  describe('Payment with token', () => {
    let mint: PublicKey;
    let protocolAta: PublicKey;
    const newAccount = Keypair.generate();
    const amount = '1000';
    const pFee = '10';
    before(async () => {
      // create token for test
      mint = await createMint(
        connection as any,
        deployer,
        deployer.publicKey,
        null,
        8
      );
      await sleep(2000);
      await airdropTokenToUser(connection, mint, deployer, deployer.publicKey, 2000 * 10 ** 8);

      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: mint,
        amount: '0.001',
        connection,
      });
      const transaction = new Transaction().add(...addWhitelistIns);
      await sendAndConfirmTransaction(connection, transaction, [operator], { commitment: 'confirmed' });
    });

    it('Should succeed', async () => {
      const tradeId = sha256('0x11');
      const currentTime = await getBlockTime(connection);

      const beforeFromUserBalance = await getTokenBalance(connection, mint, deployer.publicKey);
      const beforeToUserBalance = await getTokenBalance(connection, mint, newAccount.publicKey);
      const beforeProtocolBalance = await getTokenBalance(connection, mint, protocolPda);

      const paymentInstructions = await createPaymentAndRefundAtaAndProtocolAtaIfNeededInstructions({
        fromUser: deployer.publicKey,
        toUser: newAccount.publicKey,
        tradeId,
        token: mint,
        amount,
        totalFee: pFee,
        deadline: currentTime + 3000,
        connection,
      });

      try {
        const transaction = new Transaction().add(...paymentInstructions);
        const tx = await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }

      const afterFromUserBalance = await getTokenBalance(connection, mint, deployer.publicKey);
      const afterToUserBalance = await getTokenBalance(connection, mint, newAccount.publicKey);
      const afterProtocolBalance = await getTokenBalance(connection, mint, protocolPda);
      assert.equal(beforeFromUserBalance - afterFromUserBalance, Number(amount) * 10 ** 8 , 'From user balance should be decreased');
      assert.equal(afterToUserBalance - beforeToUserBalance, Number(amount) * 10 ** 8 - Number(pFee) * 10 ** 8, 'To user balance should be increased');
      assert.equal(afterProtocolBalance - beforeProtocolBalance, Number(pFee) * 10 ** 8, 'Protocol balance should be increased');

      const paymentReceiptPda = getPaymentReceiptPda({
        fromUser: deployer.publicKey,
        toUser: newAccount.publicKey,
        tradeId,
        token: mint,
        amount,
        protocolFee: pFee,
        tokenDecimals: 8,
      });
      const paymentReceiptData = await getPaymentReceiptData(paymentReceiptPda, connection);
      assert.equal(paymentReceiptData.fromPubkey.toBase58(), deployer.publicKey.toBase58(), 'From user should be the same');
      assert.equal(paymentReceiptData.toPubkey.toBase58(), newAccount.publicKey.toBase58(), 'To user should be the same');
      assert.equal(paymentReceiptData.tradeId.toString(), bigintToBytes32(BigInt(tradeId)).toString(), 'Trade id should be the same');
      assert.equal(paymentReceiptData.totalFee.toNumber(), Number(pFee) * 10 ** 8, 'Protocol fee should be the same');
      assert.equal(paymentReceiptData.paymentAmount.toNumber(), Number(amount) * 10 ** 8, 'Amount should be the same');
      assert.equal(paymentReceiptData.token.toBase58(), mint.toBase58(), 'Token should be the same');
    });

    it('Should fail when do not have enough amount', async () => {
      const tradeId = sha256('0x11');
      const currentTime = await getBlockTime(connection);
      const paymentInstructions = await createPaymentAndRefundAtaAndProtocolAtaIfNeededInstructions({
        fromUser: newAccount.publicKey,
        toUser: deployer.publicKey,
        tradeId,
        token: mint,
        amount,
        totalFee: pFee,
        deadline: currentTime + 3000,
        connection,
      });

      try {
        const transaction = new Transaction().add(...paymentInstructions);
        transaction.feePayer = deployer.publicKey
        await sendAndConfirmTransaction(connection, transaction, [newAccount, deployer], { commitment: 'confirmed' });
        assert.fail(`Should not reach here`);
      } catch (error) {
        expect(error.toString()).to.include('custom program error: 0x1');
        // throw error;
      }
    });
  });
});
