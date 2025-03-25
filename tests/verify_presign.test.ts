import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { OptimexSolSmartcontract } from '../target/types/optimex_sol_smartcontract';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import { expect } from 'chai';
import { airdropTokenToUser, createTokenPair, getTokenBalance } from './utils';
import { keccak256, toUtf8Bytes } from 'ethers';
import { assert } from 'chai';
import crypto from 'crypto';
import { solverAddress } from './example-data';
import {
  createMint,
} from '@solana/spl-token';
import { getProtocolPda, getTradeVaultPda, getUserTradeDetailPda, getVaultPda } from '../solana-js/pda/get_pda_address';
import { createInitializeProgramInstructions } from '../solana-js/instructions/intialize';
import { createDepositAndVaultAtaIfNeededAndNonceAccountInstructions } from '../solana-js/instructions/deposit';
import { createNonceAdvanceAndSettlementInstruction, createUserPresignSettlementTransactionAndSerializeToString } from '../solana-js/instructions/settlement';
import { createAssociatedTokenAccountInstructionIfNeeded, verifyPresignSettlement } from '../solana-js/instructions/helpers';
import { getTradeInput } from '../solana-js/utils/param_utils';
import { createAddOperatorInstruction } from '../solana-js/instructions/manage_operator';
import { WSOL_MINT } from '../solana-js/constants';
import { createAddOrUpdateWhitelistInstruction } from '../solana-js/instructions/manage_config';
import { SystemProgram } from '@solana/web3.js';
import { InvalidPresignStringError } from '../solana-js/errors';

dotenv.config();

let anchorProvider: anchor.AnchorProvider;

describe('Verify presign settlement', () => {
  // Configure the client to use the local cluster.
  anchorProvider = anchor.AnchorProvider.env();
  anchor.setProvider(anchorProvider);

  const program = anchor.workspace
    .OptimexSolSmartcontract as Program<OptimexSolSmartcontract>;

  const connection = new Connection('http://127.0.0.1:8899', { commitment: 'confirmed' });
  const deployer = (anchorProvider.wallet as anchor.Wallet).payer;

  const protocolPda = getProtocolPda();

  const user = Keypair.generate();
  const mpc = Keypair.generate();
  const operator = Keypair.generate();
  let rentForSpace8 = 0;
  before(async () => {
    await anchorProvider.connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL * 1000);
    await anchorProvider.connection.requestAirdrop(mpc.publicKey, LAMPORTS_PER_SOL * 1000);
    // Each empty PDA account has 8 bytes for discriminator
    rentForSpace8 = await anchorProvider.connection.getMinimumBalanceForRentExemption(8);
  });

  describe('Init() functional testing', () => {

    it('Should success when deployer init', async () => {
      const vaultPda = getVaultPda();
      const instructions = await createInitializeProgramInstructions({ signer: deployer.publicKey, connection, admin: deployer.publicKey });
      const transaction = new Transaction().add(...instructions);
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }

      // Expect vault and protocol pda is already init
      const vaultPdaAccountInfo = await connection.getAccountInfo(vaultPda, 'confirmed');

      assert.equal(
        vaultPdaAccountInfo.owner.toString(),
        program.programId.toString(),
        'Expect owner of vault pda is optimex smart-contract'
      )

      const protocolPdaAccountInfo = await connection.getAccountInfo(protocolPda);

      assert.equal(
        protocolPdaAccountInfo.owner.toString(),
        program.programId.toString(),
        'Expect owner of protocol pda is optimex smart-contract'
      )
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
      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: WSOL_MINT,
        amount: BigInt(0.001 * LAMPORTS_PER_SOL),
        connection: connection,
      });
      const transaction = new Transaction().add(...addWhitelistIns);
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      await sendAndConfirmTransaction(connection, transaction, [operator], { commitment: 'confirmed' });
    });
  });

  describe('Deposit and verify presign settlement with SOL', () => {
    const userEphemeralKey = Keypair.generate();
    const pmmKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const [fromToken, toToken] = createTokenPair();
    const amount = 0.05 * LAMPORTS_PER_SOL;
    let settlementPresign: string;
    const depositParams = {
      sessionId,
      userPubkey: user.publicKey,
      mpcPubkey: mpc.publicKey,
      userEphemeralPubkey: userEphemeralKey.publicKey,
      amount: BigInt(amount),
      connection: connection,
      scriptTimeout: Math.floor(Date.now() / 1000) + 3000,
      fromToken,
      toToken,
      solver: solverAddress,
      toUserAddress: '0x9fc3da866e7df3a1c57ade1a97c9f00a70f010c8',
      refundPubkey: refundKey.publicKey,
    };
    it('Should succeed with amount', async () => {
      const { tradeId } = await getTradeInput(depositParams);
      const vaultPda = getTradeVaultPda(tradeId);
      const instructions = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParams)

      const beforeVaultBalance = await connection.getBalance(vaultPda, { commitment: 'confirmed' });

      try {
        const transaction = new Transaction().add(...instructions);
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.feePayer = deployer.publicKey;
        await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey, deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.log('Error: ', error);
        throw error;
      }

      const afterVaultBalance = await connection.getBalance(vaultPda, { commitment: 'confirmed' });
      assert.equal(afterVaultBalance - beforeVaultBalance, rentForSpace8 + amount, 'Vault balance should increase by the amount of SOL deposited and init fee');

      const userTradeDetail = getUserTradeDetailPda(tradeId);
      const userTradeDetailData = await program.account.tradeDetail.fetch(userTradeDetail);
      assert.equal(userTradeDetailData.amount.toNumber(), amount, 'User trade detail amount should be the amount of SOL deposited');
      assert.equal(userTradeDetailData.mpcPubkey.toBase58(), mpc.publicKey.toBase58(), 'User trade detail mpc pubkey should be the mpc pubkey');
      assert.equal(userTradeDetailData.refundPubkey.toBase58(), refundKey.publicKey.toBase58(), 'User trade detail refund pubkey should be the refund pubkey');
      assert.equal(userTradeDetailData.userPubkey.toBase58(), user.publicKey.toBase58(), 'User trade detail user pubkey should be the user pubkey');
      assert.isNull(userTradeDetailData.token, 'User trade detail token should be null');
      assert.equal(userTradeDetailData.userEphemeralPubkey.toBase58(), userEphemeralKey.publicKey.toBase58(), 'User trade detail user ephemeral pubkey should be the user ephemeral pubkey');
      assert.isNull(userTradeDetailData.totalFee, 'User trade detail total fee should be null');
      assert.isObject(userTradeDetailData.status.deposited, 'User trade detail status should be deposited');
      assert.isUndefined(userTradeDetailData.status.claimed, 'User trade detail status should be undefined');
      assert.isUndefined(userTradeDetailData.status.settled, 'User trade detail status should be undefined');
    });


    it(`Create presign settlement string`, async () => {
      const { tradeId } = await getTradeInput(depositParams);
      settlementPresign = await createUserPresignSettlementTransactionAndSerializeToString({
        tradeId: tradeId,
        mpcPubkey: mpc.publicKey,
        pmmPubkey: pmmKey.publicKey,
        connection: connection,
        userEphemeral: userEphemeralKey
      });
    })

    it('Verify presign settlement success', async () => {
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: settlementPresign,
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isTrue(isVerified, 'Presign settlement should be verified');
      assert.isNull(error, 'Error should be null');
    })

    it('Verify presign settlement error when signatures is not valid', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = user.publicKey;
      transaction.sign(user);
      const recoveredTransaction = Transaction.from(Buffer.from(settlementPresign, 'hex'));
      recoveredTransaction.signatures[1].signature = transaction.signatures[0].signature;
      const fakePresign = recoveredTransaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('hex');
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: fakePresign,
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid verify signatures'), 'Error should be signature verification failed');
    })

    it('Verify presign settlement error when signatures is not equal to 2', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = user.publicKey;
      transaction.sign(user);
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize().toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid number of signatures'), 'Number of signatures should be 2');
    })

    it('Verify presign settlement error when first signature is not the mpc', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = deployer.publicKey;
      transaction.sign(deployer, user);
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize().toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid MPC pubkey'), 'MPC pubkey should be the mpc pubkey');
    })

    it('Verify presign settlement error when the MPCs signature is not null', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = mpc.publicKey;
      transaction.sign(mpc, user);
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize().toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('presign signature is not null'), 'MPC signature should be null');
    })

    it('Verify presign settlement error when the second signature is not the user ephemeral', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = mpc.publicKey;
      transaction.partialSign(user);
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize({ requireAllSignatures: false, verifySignatures: true }).toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid ephemeral settlement signatures'), 'Ephemeral pubkey should be the user ephemeral pubkey');
    })

    it('Verify presign settlement error when the ephemeral pubkey signature is null', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: userEphemeralKey.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = mpc.publicKey;
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize({ requireAllSignatures: false, verifySignatures: true }).toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid ephemeral settlement signatures with information'), 'Ephemeral signature should be not null');
    })

    it('Verify presign settlement error when transaction is not expected settlement', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: userEphemeralKey.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = mpc.publicKey;
      transaction.partialSign(userEphemeralKey);
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize({ requireAllSignatures: false, verifySignatures: true }).toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid ephemeral settlement signature'), 'Transaction should be the expected settlement transaction');
    })

    it('Verify presign settlement error when transaction is not formated settlement transaction', async () => {
      const { tradeId } = await getTradeInput(depositParams);
      const createIns = await createNonceAdvanceAndSettlementInstruction({
        tradeId,
        mpcPubkey: mpc.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        pmmPubkey: pmmKey.publicKey,
        connection: connection
      });
      const transaction = new Transaction().add(...createIns).add(SystemProgram.transfer({
        fromPubkey: userEphemeralKey.publicKey,
        toPubkey: refundKey.publicKey,
        lamports: 1000000
      }));
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = mpc.publicKey;
      transaction.partialSign(userEphemeralKey);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize({ requireAllSignatures: false, verifySignatures: true }).toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid ephemeral settlement signature'), 'Transaction should be the expected settlement transaction');
    })
  });

  describe('Deposit and verify presign settlement with Tokens', () => {
    const mint = Keypair.generate();
    let tradeId: string;
    let settlementPresign: string;
    const tokenMint = mint.publicKey;
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const pmmKey = Keypair.generate();
    const [fromToken, toToken] = createTokenPair(tokenMint.toBase58());
    const amount = 100 * 10**9;
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const depositParams = {
      sessionId,
      userPubkey: user.publicKey,
      mpcPubkey: mpc.publicKey,
      userEphemeralPubkey: userEphemeralKey.publicKey,
      amount: BigInt(amount),
      connection: anchorProvider.connection,
      scriptTimeout: Math.floor(Date.now() / 1000) + 3000,
      fromToken,
      toToken,
      solver: solverAddress,
      refundPubkey: refundKey.publicKey,
      toUserAddress: '0x9fc3da866e7df3a1c57ade1a97c9f00a70f010c8',
    }
    before(async () => {
      await createMint(
        connection,
        deployer,
        deployer.publicKey,
        null,
        9,
        mint,
        { commitment: 'confirmed' }
      );

      // create or get vault ata
      await airdropTokenToUser(connection, tokenMint, deployer, user.publicKey, 1000 * 10 ** 9);
      const pmmAtaIns = await createAssociatedTokenAccountInstructionIfNeeded(connection, deployer.publicKey, tokenMint, pmmKey.publicKey);
      const protocolAtaIns = await createAssociatedTokenAccountInstructionIfNeeded(connection, deployer.publicKey, tokenMint, protocolPda);
      const transaction = new Transaction().add(...pmmAtaIns, ...protocolAtaIns);
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });

      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: tokenMint,
        amount: BigInt(0.001 * LAMPORTS_PER_SOL),
        connection: connection,
      });

      const addWhitelistTransaction = new Transaction().add(...addWhitelistIns);
      addWhitelistTransaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      await sendAndConfirmTransaction(connection, addWhitelistTransaction, [operator], { commitment: 'confirmed' });
    });

    it('Should succeed with SPL token deposit', async () => {
      const instructions = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParams)

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
      } catch (error) {
        console.log('Error: ', error);
        throw error;
      }

      const afterUserTokenBalance = await getTokenBalance(connection, tokenMint, user.publicKey);
      assert.equal(beforeUserTokenBalance - afterUserTokenBalance, amount, 'User token balance should decrease by the amount of token deposited');
      ({ tradeId } = await getTradeInput(depositParams));
      const userTradeDetail = getUserTradeDetailPda(tradeId);
      const userTradeDetailData = await program.account.tradeDetail.fetch(userTradeDetail);
      assert.equal(userTradeDetailData.amount.toNumber(), amount, 'User trade detail amount should be the amount of token deposited');
      assert.equal(userTradeDetailData.mpcPubkey.toBase58(), mpc.publicKey.toBase58(), 'User trade detail mpc pubkey should be the mpc pubkey');
      assert.equal(userTradeDetailData.refundPubkey.toBase58(), refundKey.publicKey.toBase58(), 'User trade detail refund pubkey should be the refund pubkey');
      assert.equal(userTradeDetailData.userPubkey.toBase58(), user.publicKey.toBase58(), 'User trade detail user pubkey should be the user pubkey');
      assert.equal(userTradeDetailData.token.toBase58(), tokenMint.toBase58(), 'User trade detail token should be the token mint');
      assert.equal(userTradeDetailData.userEphemeralPubkey.toBase58(), userEphemeralKey.publicKey.toBase58(), 'User trade detail user ephemeral pubkey should be the user ephemeral pubkey');
      assert.isObject(userTradeDetailData.status.deposited, 'User trade detail status should be deposited');
    });

    it(`Create presign string success`, async () => {
      settlementPresign = await createUserPresignSettlementTransactionAndSerializeToString({
        tradeId: tradeId,
        mpcPubkey: mpc.publicKey,
        pmmPubkey: pmmKey.publicKey,
        connection: connection,
        userEphemeral: userEphemeralKey
      });

    })

    it('Verify presign settlement success', async () => {
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: settlementPresign,
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isTrue(isVerified, 'Presign settlement should be verified');
      assert.isNull(error, 'Error should be null');
    })

    it('Verify presign settlement error when signatures is not valid', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = user.publicKey;
      transaction.sign(user);
      const recoveredTransaction = Transaction.from(Buffer.from(settlementPresign, 'hex'));
      recoveredTransaction.signatures[1].signature = transaction.signatures[0].signature;
      const fakePresign = recoveredTransaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('hex');
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: fakePresign,
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid verify signatures'), 'Error should be signature verification failed');
    })

    it('Verify presign settlement error when signatures is not equal to 2', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = user.publicKey;
      transaction.sign(user);
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize().toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid number of signatures'), 'Number of signatures should be 2');
    })

    it('Verify presign settlement error when first signature is not the mpc', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = deployer.publicKey;
      transaction.sign(deployer, user);
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize().toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid MPC pubkey'), 'MPC pubkey should be the mpc pubkey');
    })

    it('Verify presign settlement error when the MPCs signature is not null', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = mpc.publicKey;
      transaction.sign(mpc, user);
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize().toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('presign signature is not null'), 'MPC signature should be null');
    })

    it('Verify presign settlement error when the second signature is not the user ephemeral', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = mpc.publicKey;
      transaction.partialSign(user);
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize({ requireAllSignatures: false, verifySignatures: true }).toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid ephemeral settlement signatures'), 'Ephemeral pubkey should be the user ephemeral pubkey');
    })

    it('Verify presign settlement error when the ephemeral pubkey signature is null', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: userEphemeralKey.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = mpc.publicKey;
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize({ requireAllSignatures: false, verifySignatures: true }).toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid ephemeral settlement signatures with information'), 'Ephemeral signature should be not null');
    })

    it('Verify presign settlement error when transaction is not expected settlement', async () => {
      const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: userEphemeralKey.publicKey,
          toPubkey: refundKey.publicKey,
          lamports: 1000000
        })
      );
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = mpc.publicKey;
      transaction.partialSign(userEphemeralKey);
      const { tradeId } = await getTradeInput(depositParams);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize({ requireAllSignatures: false, verifySignatures: true }).toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid ephemeral settlement signature'), 'Transaction should be the expected settlement transaction');
    })

    it('Verify presign settlement error when transaction is not formated settlement transaction', async () => {
      const { tradeId } = await getTradeInput(depositParams);
      const createIns = await createNonceAdvanceAndSettlementInstruction({
        tradeId,
        mpcPubkey: mpc.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        pmmPubkey: pmmKey.publicKey,
        connection: connection
      });
      const transaction = new Transaction().add(...createIns).add(SystemProgram.transfer({
        fromPubkey: userEphemeralKey.publicKey,
        toPubkey: refundKey.publicKey,
        lamports: 1000000
      }));
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = mpc.publicKey;
      transaction.partialSign(userEphemeralKey);
      const { error, isVerified } = await verifyPresignSettlement({
        connection: connection,
        tradeId: tradeId,
        presign: transaction.serialize({ requireAllSignatures: false, verifySignatures: true }).toString('hex'),
        pmmPubkey: pmmKey.publicKey,
      });
      assert.isFalse(isVerified, 'Presign settlement should not be verified');
      expect(error).is.instanceOf(InvalidPresignStringError, 'Error should be InvalidPresignStringError');
      assert.isTrue(error.toString().includes('Invalid ephemeral settlement signature'), 'Transaction should be the expected settlement transaction');
    })

  });
});

