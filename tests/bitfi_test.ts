import * as anchor from '@coral-xyz/anchor';
import { Program, EventParser, BorshCoder } from '@coral-xyz/anchor';
import { BitfiSolSmartcontract } from '../target/types/bitfi_sol_smartcontract';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import { expect } from 'chai';
import { airdropTokenToUser, createTokenPair, getBlockTime, getTokenBalance, sleep } from './utils';
import { keccak256, toUtf8Bytes } from 'ethers';
import { assert } from 'chai';
import crypto from 'crypto';
import { solverAddress } from './example-data';
import {
  createAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  createMint,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { getProtocolPda, getUserTradeDetailPda, getVaultPda, getWhitelistPda } from '../bitfi-solana-js/pda/get_pda_address';
import { createInitializePetafiInstructions } from '../bitfi-solana-js/instructions/intialize';
import { createDepositAndVaultAtaIfNeededInstructions, DepositInstructionParam } from '../bitfi-solana-js/instructions/deposit';
import { createUserPresignSettlementTransactionAndSerializeToString } from '../bitfi-solana-js/instructions/settlement';
import { createCreateAssociatedTokenAccountInstructionIfNeeded } from '../bitfi-solana-js/instructions/helpers';
import { getTradeInput } from '../bitfi-solana-js/utils/param_utils';
import { createClaimAndRefundAtaAndProtocolAtaIfNeededInstructions } from '../bitfi-solana-js/instructions/claim';
import { createSetTotalFeeInstructions } from '../bitfi-solana-js/instructions/set_total_fee';
import { createAddOperatorInstruction } from '../bitfi-solana-js/instructions/manage_operator';
import { WSOL_MINT } from '../bitfi-solana-js/constants';
import { createAddOrUpdateWhitelistInstruction } from '../bitfi-solana-js/instructions/manage_config';
import { SystemProgram } from '@solana/web3.js';

dotenv.config();

let anchorProvider: anchor.AnchorProvider;

describe('bitfi-sol-smartcontract', () => {
  // Configure the client to use the local cluster.
  anchorProvider = anchor.AnchorProvider.env();
  anchor.setProvider(anchorProvider);

  const program = anchor.workspace
    .BitfiSolSmartcontract as Program<BitfiSolSmartcontract>;

  const connection = new Connection('http://127.0.0.1:8899', { commitment: 'confirmed' });
  const deployer = (anchorProvider.wallet as anchor.Wallet).payer;

  const vaultPda = getVaultPda();

  const protocolPda = getProtocolPda();

  const user = Keypair.generate();
  const mpc = Keypair.generate();
  const operator = Keypair.generate();

  before(async () => {
    await anchorProvider.connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL * 1000);
    await anchorProvider.connection.requestAirdrop(mpc.publicKey, LAMPORTS_PER_SOL * 1000);
  });

  describe('Init() functional testing', () => {

    it('Should success when deployer init', async () => {
      const instructions = await createInitializePetafiInstructions({ signer: deployer.publicKey, connection, admin: deployer.publicKey });
      const transaction = new Transaction().add(...instructions);
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      try {
        const txHash = await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }

      // Expect vault and protocol pda is already init
      let vaultPdaAccountInfo = await connection.getAccountInfo(vaultPda);

      expect(
        vaultPdaAccountInfo.owner.toString() === program.programId.toString(),
        'Expect owner of vault pda is Bitfi smart-contract'
      ).to.be.true;

      let protocolPdaAccountInfo = await connection.getAccountInfo(protocolPda);

      expect(
        protocolPdaAccountInfo.owner.toString() ===
        program.programId.toString(),
        'Expect owner of protocol pda is Bitfi smart-contract'
      ).to.be.true;
    });

    it('Deployer add operator successfully', async () => {
      await connection.requestAirdrop(operator.publicKey, LAMPORTS_PER_SOL * 10);
      const addOperatorIns = await createAddOperatorInstruction({
        signer: deployer.publicKey,
        operator: operator.publicKey,
        connection: connection,
      });
      const transaction = new Transaction().add(...addOperatorIns);
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
    });

    it('Operator add whitelist for WSOL successfully', async () => {
      const whitelistToken = getWhitelistPda(WSOL_MINT);
      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: WSOL_MINT,
        amount: '0.001',
        connection: connection,
      });
      const transaction = new Transaction().add(...addWhitelistIns);
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      await sendAndConfirmTransaction(connection, transaction, [operator], { commitment: 'confirmed' });
    });
  });


  describe('Deposit(), setFee and settle successfully with WSOL', () => {
    let tokenMint = WSOL_MINT;
    let vaultAta: any;
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const pmmKey = Keypair.generate();
    const [fromToken, toToken] = createTokenPair(tokenMint.toBase58());
    const amount = 0.1;
    const feeAmount = 0.01;
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const wrapSolTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        deployer.publicKey,
        getAssociatedTokenAddressSync(tokenMint, user.publicKey),
        user.publicKey,
        tokenMint,
      ),
      SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: getAssociatedTokenAddressSync(tokenMint, user.publicKey),
        lamports: BigInt(1 * LAMPORTS_PER_SOL),
      }),
      createSyncNativeInstruction(getAssociatedTokenAddressSync(tokenMint, user.publicKey)),
    )


    const depositParams = {
      sessionId,
      userPubkey: user.publicKey,
      mpcPubkey: mpc.publicKey,
      userEphemeralPubkey: userEphemeralKey.publicKey,
      amount: amount.toString(),
      connection: anchorProvider.connection,
      scriptTimeout: Math.floor(Date.now() / 1000) + 3000,
      fromToken,
      toToken,
      solver: solverAddress,
      refundPubkey: refundKey.publicKey,
      toUserAddress: 'tb1q85w8v43nj5gq2elmc57fj0jrk8q900sk3udj8h',
    }
    const isNativeToken = fromToken.tokenSymbol === 'SOL';
    before(async () => {
      const deployerBalance = await connection.getBalance(deployer.publicKey);
      const wrapSolTxSig = await sendAndConfirmTransaction(connection, wrapSolTx, [deployer], { commitment: 'confirmed' });
      // create or get vault ata
      const pmmAtaIns = await createCreateAssociatedTokenAccountInstructionIfNeeded(connection, deployer.publicKey, tokenMint, pmmKey.publicKey);
      const protocolAtaIns = await createCreateAssociatedTokenAccountInstructionIfNeeded(connection, deployer.publicKey, tokenMint, protocolPda);
      const transaction = new Transaction().add(...pmmAtaIns, ...protocolAtaIns);
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const createAtaSig = await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });

      // const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
      //   operator: operator.publicKey,
      //   token: tokenMint,
      //   amount: '0.001',
      //   connection: connection,
      // });
      // const addWhitelistTransaction = new Transaction().add(...addWhitelistIns);
      // addWhitelistTransaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      // await sendAndConfirmTransaction(connection, addWhitelistTransaction, [operator], { commitment: 'confirmed' });
    });

    it('Should succeed with SPL token deposit', async () => {
      const instructions = await createDepositAndVaultAtaIfNeededInstructions(depositParams)

      const beforeUserTokenBalance = await getTokenBalance(connection, tokenMint, user.publicKey);
      try {
        const transaction = new Transaction().add(...instructions);
        const latestBlockhash = await connection.getLatestBlockhash()
        transaction.recentBlockhash = latestBlockhash.blockhash;
        transaction.feePayer = user.publicKey;
        const sig = await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey], { commitment: 'confirmed' });
        await connection.confirmTransaction({
          signature: sig,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        }, 'confirmed')
      const tx = await connection.getTransaction(sig, { commitment: 'confirmed' });
      const eventParser = new EventParser(program.programId, new BorshCoder(program.idl));
      const events = await eventParser.parseLogs(tx.meta.logMessages);
      for (const event of events) {
        console.log(event);
      }
      } catch (error) {
        console.log('Error: ', error);
        throw error;
      }

      const afterUserTokenBalance = await getTokenBalance(connection, tokenMint, user.publicKey);
      assert.equal(beforeUserTokenBalance - afterUserTokenBalance, amount * 10 ** 9, 'User token balance should decrease by the amount of token deposited');
      const { tradeId } = await getTradeInput(depositParams);
      const userTradeDetail = getUserTradeDetailPda(tradeId);
      const userTradeDetailData = await program.account.tradeDetail.fetch(userTradeDetail);
      assert.equal(userTradeDetailData.amount.toNumber(), amount * 10 ** 9, 'User trade detail amount should be the amount of token deposited');
      assert.equal(userTradeDetailData.mpcPubkey.toBase58(), mpc.publicKey.toBase58(), 'User trade detail mpc pubkey should be the mpc pubkey');
      assert.equal(userTradeDetailData.refundPubkey.toBase58(), refundKey.publicKey.toBase58(), 'User trade detail refund pubkey should be the refund pubkey');
      assert.equal(userTradeDetailData.userPubkey.toBase58(), user.publicKey.toBase58(), 'User trade detail user pubkey should be the user pubkey');
      assert.equal(userTradeDetailData.token.toBase58(), tokenMint.toBase58(), 'User trade detail token should be the token mint');
      assert.equal(userTradeDetailData.userEphemeralPubkey.toBase58(), userEphemeralKey.publicKey.toBase58(), 'User trade detail user ephemeral pubkey should be the user ephemeral pubkey');

    });

    it(`Should set protocol fee successfully`, async () => {
      const { tradeId } = await getTradeInput(depositParams);
      const setFeeIns = await createSetTotalFeeInstructions({
        tradeId: tradeId,
        amount: feeAmount.toString(),
        mpcPubkey: mpc.publicKey,
        connection: connection,
      })
      const transaction = new Transaction().add(...setFeeIns);
      try {
        const sig = await sendAndConfirmTransaction(connection, transaction, [mpc], { commitment: 'confirmed' });
      } catch (error) {
        console.log('Error: ', error);
        throw error;
      }

      const userTradeDetail = getUserTradeDetailPda(tradeId);
      const userTradeDetailData = await program.account.tradeDetail.fetch(userTradeDetail);
      assert.equal(userTradeDetailData.totalFee.toNumber(), feeAmount * LAMPORTS_PER_SOL, 'User protocol fee amount should be the fee amount');
    });

    it(`Should setlle successfully`, async () => {
      const { tradeId } = await getTradeInput(depositParams);
      const settlementPresign = await createUserPresignSettlementTransactionAndSerializeToString({
        tradeId: tradeId,
        mpcPubkey: mpc.publicKey,
        pmmPubkey: pmmKey.publicKey,
        connection: connection,
        userEphemeral: userEphemeralKey
      });

      const recoveredTransaction = Transaction.from(Buffer.from(settlementPresign, 'hex'));
      recoveredTransaction.partialSign(mpc);
      const beforeVaultBalance = await getTokenBalance(connection, tokenMint, vaultPda);
      const beforeProtocolVaultBalance = await getTokenBalance(connection, tokenMint, protocolPda);
      try {
        const latestBlockhash = await connection.getLatestBlockhash()
        const sig = await connection.sendRawTransaction(recoveredTransaction.serialize(), {
          skipPreflight: false,
        });
        await connection.confirmTransaction({
          signature: sig,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        }, 'confirmed')
      const tx = await connection.getTransaction(sig, { commitment: 'confirmed' });
      const eventParser = new EventParser(program.programId, new BorshCoder(program.idl));
      const events = await eventParser.parseLogs(tx.meta.logMessages);
      for (const event of events) {
        console.log(event);
      }
      } catch (error) {
        console.log('Error: ', error);
        throw error;
      }
      const afterVaultBalance = await getTokenBalance(connection, tokenMint, vaultPda);
      const afterProtocolVaultBalance = await getTokenBalance(connection, tokenMint, protocolPda);
      assert.equal(beforeVaultBalance - afterVaultBalance, amount * 10 ** 9, 'Vault balance should decrease by the amount of token deposited');
      assert.equal(afterProtocolVaultBalance - beforeProtocolVaultBalance, feeAmount * 10 ** 9, 'Protocol vault balance should increase by the fee amount amount of token setup');
    })
  });
});

