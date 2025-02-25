import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PetaFiSolSmartcontract } from '../target/types/peta_fi_sol_smartcontract';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  NONCE_ACCOUNT_LENGTH,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import { expect, use } from 'chai';
import { airdropTokenToUser, createTokenPair, getBlockTime, getTokenBalance, sleep } from './utils';
import { FeeDataNetworkPlugin, keccak256, recoverAddress, toUtf8Bytes } from 'ethers';
import { assert } from 'chai';
import crypto from 'crypto';
import { solverAddress } from './example-data';
import {
  createAssociatedTokenAccountInstruction,
  createMint,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { getFeeReceiverPda, getProtocolPda, getTradeVaultPda, getUserTradeDetailPda, getVaultPda, getWhitelistPda } from '../petafi-solana-js/pda/get_pda_address';
import { createInitializePetaFiInstructions } from '../petafi-solana-js/instructions/intialize';
import { createDepositAndVaultAtaIfNeededAndNonceAccountInstructions, DepositInstructionParam } from '../petafi-solana-js/instructions/deposit';
import { createUserPresignSettlementTransactionAndSerializeToString } from '../petafi-solana-js/instructions/settlement';
import { createAssociatedTokenAccountInstructionIfNeeded } from '../petafi-solana-js/instructions/helpers';
import { getTradeInput } from '../petafi-solana-js/utils/param_utils';
import { createClaimAndRefundAtaAndProtocolAtaIfNeededInstructions } from '../petafi-solana-js/instructions/claim';
import { createSetTotalFeeInstructions } from '../petafi-solana-js/instructions/set_total_fee';
import { createAddOperatorInstruction } from '../petafi-solana-js/instructions/manage_operator';
import { WSOL_MINT } from '../petafi-solana-js/constants';
import { createAddFeeReceiverInstruction, createAddOrUpdateWhitelistInstruction } from '../petafi-solana-js/instructions/manage_config';
import { SystemProgram } from '@solana/web3.js';
import { getTradeDetailData } from '../petafi-solana-js/pda/get_pda_data';
import { createCloseFinishedTradeInstructions } from '../petafi-solana-js/instructions/close_finished_trade';
import { bigintToBytes32 } from '../petafi-solana-js/utils/parse_utils';
import { createReceiverAtaIfNeededAndWithdrawTotalFeeInstruction } from '../petafi-solana-js/instructions/withdraw_total_fee';
import { InvalidParamError } from '../petafi-solana-js/errors/invalid_param_error';

dotenv.config();

let anchorProvider: anchor.AnchorProvider;

describe('bitfi-sol-smartcontract', () => {
  // Configure the client to use the local cluster.
  anchorProvider = anchor.AnchorProvider.env();
  anchor.setProvider(anchorProvider);

  const program = anchor.workspace
    .PetaFiSolSmartcontract as Program<PetaFiSolSmartcontract>;

  const connection = new Connection('http://127.0.0.1:8899', { commitment: 'confirmed' });
  const deployer = (anchorProvider.wallet as anchor.Wallet).payer;

  const protocolPda = getProtocolPda();

  const user = Keypair.generate();
  const mpc = Keypair.generate();
  const operator = Keypair.generate();
  const feeReceiver = Keypair.generate();
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
      const instructions = await createInitializePetaFiInstructions({ signer: deployer.publicKey, connection, admin: deployer.publicKey });
      const transaction = new Transaction().add(...instructions);
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      try {
        const txHash = await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }

      // Expect vault and protocol pda is already init
      let vaultPdaAccountInfo = await connection.getAccountInfo(vaultPda, 'confirmed');

      expect(
        vaultPdaAccountInfo.owner.toString() === program.programId.toString(),
        'Expect owner of vault pda is PetaFi smart-contract'
      ).to.be.true;

      let protocolPdaAccountInfo = await connection.getAccountInfo(protocolPda);

      expect(
        protocolPdaAccountInfo.owner.toString() ===
        program.programId.toString(),
        'Expect owner of protocol pda is PetaFi smart-contract'
      ).to.be.true;
    });

    it('Admin add operator successfully', async () => {
      await connection.requestAirdrop(operator.publicKey, LAMPORTS_PER_SOL * 10);
      await connection.requestAirdrop(feeReceiver.publicKey, LAMPORTS_PER_SOL * 10);
      const addOperatorIns = await createAddOperatorInstruction({
        signer: deployer.publicKey,
        operator: operator.publicKey,
        connection: connection,
      });
      const transaction = new Transaction().add(...addOperatorIns);
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
    });

    it('Admin add fee receiver successfully', async () => {
      await connection.requestAirdrop(feeReceiver.publicKey, LAMPORTS_PER_SOL * 10);
      const addFeeReceiverIns = await createAddFeeReceiverInstruction({
        signer: deployer.publicKey,
        receiver: feeReceiver.publicKey,
        connection: connection,
      });
      const transaction = new Transaction().add(...addFeeReceiverIns);
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

  describe('Deposit(), setFee and settlement with SOL successfully', () => {
    const userEphemeralKey = Keypair.generate();
    const pmmKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const [fromToken, toToken] = createTokenPair();
    const amount = 0.05;
    const feeAmount = 0.01;
    const smallFee = 0.0001;
    const depositParams = {
      sessionId,
      userPubkey: user.publicKey,
      mpcPubkey: mpc.publicKey,
      userEphemeralPubkey: userEphemeralKey.publicKey,
      amount: amount.toString(),
      connection: connection,
      scriptTimeout: Math.floor(Date.now() / 1000) + 3000,
      fromToken,
      toToken,
      solver: solverAddress,
      toUserAddress: '0x9fc3da866e7df3a1c57ade1a97c9f00a70f010c8',
      refundPubkey: refundKey.publicKey,
    };
    const isNativeToken = fromToken.tokenSymbol === 'SOL';
    it('Should succeed with amount', async () => {
      const { tradeId } = await getTradeInput(depositParams);
      const vaultPda = getTradeVaultPda(tradeId);
      const instructions = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParams)

      const beforeVaultBalance = await connection.getBalance(vaultPda, { commitment: 'confirmed' });

      try {
        const transaction = new Transaction().add(...instructions);
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.feePayer = deployer.publicKey;
        const sig = await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey, deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.log('Error: ', error);
        throw error;
      }

      const afterVaultBalance = await connection.getBalance(vaultPda, { commitment: 'confirmed' });
      assert.equal(afterVaultBalance - beforeVaultBalance, rentForSpace8 + amount * LAMPORTS_PER_SOL, 'Vault balance should increase by the amount of SOL deposited and init fee');

      const userTradeDetail = getUserTradeDetailPda(tradeId);
      const userTradeDetailData = await program.account.tradeDetail.fetch(userTradeDetail);
      assert.equal(userTradeDetailData.tradeId.toString(), bigintToBytes32(BigInt(tradeId)).toString(), 'User trade detail tradeId should be the tradeId');
      assert.equal(userTradeDetailData.amount.toNumber(), amount * LAMPORTS_PER_SOL, 'User trade detail amount should be the amount of SOL deposited');
      assert.equal(userTradeDetailData.mpcPubkey.toBase58(), mpc.publicKey.toBase58(), 'User trade detail mpc pubkey should be the mpc pubkey');
      assert.equal(userTradeDetailData.refundPubkey.toBase58(), refundKey.publicKey.toBase58(), 'User trade detail refund pubkey should be the refund pubkey');
      assert.equal(userTradeDetailData.userPubkey.toBase58(), user.publicKey.toBase58(), 'User trade detail user pubkey should be the user pubkey');
      assert.isNull(userTradeDetailData.token, 'User trade detail token should be null');
      assert.equal(userTradeDetailData.userEphemeralPubkey.toBase58(), userEphemeralKey.publicKey.toBase58(), 'User trade detail user ephemeral pubkey should be the user ephemeral pubkey');
      assert.isObject(userTradeDetailData.status.deposited, 'User trade detail status should be deposited');
    });

    it(`Should set fee successfully`, async () => {
      const { tradeId } = await getTradeInput(depositParams);
      const setFeeIns = await createSetTotalFeeInstructions({
        tradeId,
        amount: feeAmount.toString(),
        connection,
        mpcPubkey: mpc.publicKey,
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

    it(`Should settle and transfer fee successfully`, async () => {
      const { tradeId } = await getTradeInput(depositParams);
      const vaultPda = getTradeVaultPda(tradeId);
      const settlementPresign = await createUserPresignSettlementTransactionAndSerializeToString({
        tradeId: tradeId,
        mpcPubkey: mpc.publicKey,
        pmmPubkey: pmmKey.publicKey,
        connection: connection,
        userEphemeral: userEphemeralKey
      });

      const recoveredTransaction = Transaction.from(Buffer.from(settlementPresign, 'hex'));
      recoveredTransaction.partialSign(mpc);
      const beforeVaultBalance = await connection.getBalance(vaultPda, { commitment: 'confirmed' });
      const beforeProtocolVaultBalance = await connection.getBalance(protocolPda, { commitment: 'confirmed' });
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
      } catch (error) {
        console.log('Error: ', error);
        throw error;
      }
      const afterVaultBalance = await connection.getBalance(vaultPda, { commitment: 'confirmed' });
      const afterProtocolVaultBalance = await connection.getBalance(protocolPda, { commitment: 'confirmed' });
      assert.equal(beforeVaultBalance - afterVaultBalance, amount * LAMPORTS_PER_SOL, 'Vault balance should increase by the amount of SOL deposited');
      assert.equal(afterProtocolVaultBalance - beforeProtocolVaultBalance, feeAmount * LAMPORTS_PER_SOL, 'Protocol vault balance should increase by the amount of SOL deposited');
      const userTradeDetailData = await getTradeDetailData(tradeId, connection);
      assert.isObject(userTradeDetailData.status.settled, 'User trade detail status should be settled');
      assert.equal(userTradeDetailData.settledPmm.toBase58(), pmmKey.publicKey.toBase58(), 'User trade detail settled pmm should be the pmm pubkey');
    })

    it('Should withdraw fee error when wrong fee receiver', async () => {
      const fakeFeeReceiver = Keypair.generate();
      const feeReceiverPda = getFeeReceiverPda(feeReceiver.publicKey);
      try {
        await program.methods
          .withdrawTotalFee({
            token: null,
            amount: new anchor.BN(0.01 * LAMPORTS_PER_SOL),
          })
          .accounts({
            signer: operator.publicKey,
            toUser: fakeFeeReceiver.publicKey,
            feeReceiver: feeReceiverPda,
          } as any)
          .signers([operator])
          .rpc({ commitment: 'confirmed' })
          assert.fail('Should not reach here');
      } catch (error) {
        assert.ok(error.toString().includes('InvalidRefundPubkey'), 'Should return InvalidRefundPubkey error');
      }
    })

    it('Should withdraw fee error when fee receiver is not set', async () => {
      const fakeFeeReceiver = Keypair.generate();
      const feeReceiverPda = getFeeReceiverPda(fakeFeeReceiver.publicKey);
      try {
        await program.methods
          .withdrawTotalFee({
            token: null,
            amount: new anchor.BN(0.01 * LAMPORTS_PER_SOL),
          })
          .accounts({
            signer: operator.publicKey,
            toUser: fakeFeeReceiver.publicKey,
            feeReceiver: fakeFeeReceiver,
          } as any)
          .signers([operator])
          .rpc({ commitment: 'confirmed' })
          assert.fail('Should not reach here');
      } catch (error) {
        assert.ok(error.errorLogs.some(log => log.includes('AccountNotInitialized') && log.includes('fee_receiver')), 'Should return InvalidRefundPubkey error');
      }
    })

    it('Should withdraw fee error when fee receiver is not set', async () => {
      const fakeFeeReceiver = Keypair.generate();
      const feeReceiverPda = getFeeReceiverPda(fakeFeeReceiver.publicKey);
      try {
        await program.methods
          .withdrawTotalFee({
            token: null,
            amount: new anchor.BN(0.01 * LAMPORTS_PER_SOL),
          })
          .accounts({
            signer: operator.publicKey,
            toUser: fakeFeeReceiver.publicKey,
            feeReceiver: fakeFeeReceiver,
          } as any)
          .signers([operator])
          .rpc({ commitment: 'confirmed' })
          assert.fail('Should not reach here');
      } catch (error) {
        assert.ok(error.errorLogs.some(log => log.includes('AccountNotInitialized') && log.includes('fee_receiver')), 'Should return InvalidRefundPubkey error');
      }
    });

    it('Should withdraw a small fee successfully', async () => {
      const withdrawTotalFeeIns = await createReceiverAtaIfNeededAndWithdrawTotalFeeInstruction({
        connection,
        token: null,
        receiverPubkey: feeReceiver.publicKey,
        signer: operator.publicKey,
        amount: smallFee.toString(),
      });
      const beforeProtocolBalance = await connection.getBalance(protocolPda, { commitment: 'confirmed' });
      const beforeFeeReceiverBalance = await connection.getBalance(feeReceiver.publicKey, { commitment: 'confirmed' });
      const transaction = new Transaction().add(...withdrawTotalFeeIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [operator], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const afterProtocolBalance = await connection.getBalance(protocolPda, { commitment: 'confirmed' });
      const afterFeeReceiverBalance = await connection.getBalance(feeReceiver.publicKey, { commitment: 'confirmed' });
      assert.equal(beforeProtocolBalance - afterProtocolBalance, smallFee * LAMPORTS_PER_SOL, 'The protocol balance should decrease by the amount of fee');
      assert.equal(afterFeeReceiverBalance - beforeFeeReceiverBalance, smallFee * LAMPORTS_PER_SOL, 'The fee receiver balance should increase by the amount of fee');
    })

    it('Should withdraw fee error when withdraw too much SOL', async () => {
      const protocolBalance = await connection.getBalance(protocolPda, { commitment: 'confirmed' }) / LAMPORTS_PER_SOL;
      try {
        await program.methods.withdrawTotalFee({
          token: null,
          amount: new anchor.BN(protocolBalance * 10**9)
        })
        .accounts({
          signer: operator.publicKey,
          toUser: feeReceiver.publicKey,
        })
        .signers([operator])
        .rpc({ commitment: 'confirmed' })
        assert.fail('Should not reach here');
      } catch (error) {
        assert.ok(error.toString().includes('InvalidAmount'), 'Amount to withdraw is not valid');
      }
    })

    it('Should withdraw fee error when create instruction to withdraw too much SOL', async () => {
      const protocolBalance = await connection.getBalance(protocolPda, { commitment: 'confirmed' }) / LAMPORTS_PER_SOL;
      try { 
        const withdrawTotalFeeIns = await createReceiverAtaIfNeededAndWithdrawTotalFeeInstruction({
          connection,
          token: null,
          receiverPubkey: feeReceiver.publicKey,
          signer: operator.publicKey,
          amount: String(protocolBalance),
        });
      } catch (error) {
        expect(error).to.be.instanceOf(InvalidParamError);
        assert.ok(error.toString().includes('Withdraw amount is greater'));
      }
    })


    it('Should withdraw total fee successfully', async () => {
      const withdrawTotalFeeIns = await createReceiverAtaIfNeededAndWithdrawTotalFeeInstruction({
        connection,
        token: null,
        receiverPubkey: feeReceiver.publicKey,
        signer: operator.publicKey,
        amount: null,
      });
      const beforeProtocolBalance = await connection.getBalance(protocolPda, { commitment: 'confirmed' });
      const beforeFeeReceiverBalance = await connection.getBalance(feeReceiver.publicKey, { commitment: 'confirmed' });
      const transaction = new Transaction().add(...withdrawTotalFeeIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [operator], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const afterProtocolBalance = await connection.getBalance(protocolPda, { commitment: 'confirmed' });
      const afterFeeReceiverBalance = await connection.getBalance(feeReceiver.publicKey, { commitment: 'confirmed' });
      assert.equal(beforeProtocolBalance - afterProtocolBalance, (feeAmount - smallFee) * LAMPORTS_PER_SOL, 'The protocol balance should decrease by the amount of fee');
      assert.equal(afterFeeReceiverBalance - beforeFeeReceiverBalance, (feeAmount - smallFee) * LAMPORTS_PER_SOL, 'The fee receiver balance should increase by the amount of fee');
    })
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
    const smallFee = 0.0001;
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
      toUserAddress: '0x9fc3da866e7df3a1c57ade1a97c9f00a70f010c8',
    };
    const isNativeToken = fromToken.tokenSymbol === 'SOL';
    before(async () => {
      const deployerBalance = await connection.getBalance(deployer.publicKey);
      const wrapSolTxSig = await sendAndConfirmTransaction(connection, wrapSolTx, [deployer], { commitment: 'confirmed' });
      // create or get vault ata
      const pmmAtaIns = await createAssociatedTokenAccountInstructionIfNeeded(connection, deployer.publicKey, tokenMint, pmmKey.publicKey);
      const protocolAtaIns = await createAssociatedTokenAccountInstructionIfNeeded(connection, deployer.publicKey, tokenMint, protocolPda);
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
      const vaultPda = getTradeVaultPda(tradeId);
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
      } catch (error) {
        console.log('Error: ', error);
        throw error;
      }
      const afterVaultBalance = await getTokenBalance(connection, tokenMint, vaultPda);
      const afterProtocolVaultBalance = await getTokenBalance(connection, tokenMint, protocolPda);
      assert.equal(beforeVaultBalance - afterVaultBalance, amount * 10 ** 9, 'Vault balance should decrease by the amount of token deposited');
      assert.equal(afterProtocolVaultBalance - beforeProtocolVaultBalance, feeAmount * 10 ** 9, 'Protocol vault balance should increase by the fee amount amount of token setup');
    })

    it('Should withdraw a small fee successfully', async () => {
      const withdrawTotalFeeIns = await createReceiverAtaIfNeededAndWithdrawTotalFeeInstruction({
        connection,
        token: WSOL_MINT,
        receiverPubkey: feeReceiver.publicKey,
        signer: operator.publicKey,
        amount: smallFee.toString(),
      });
      const beforeProtocolBalance = await getTokenBalance(connection, WSOL_MINT, protocolPda);
      const beforeFeeReceiverBalance = await getTokenBalance(connection, WSOL_MINT, feeReceiver.publicKey);
      const transaction = new Transaction().add(...withdrawTotalFeeIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [operator], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const afterProtocolBalance = await getTokenBalance(connection, WSOL_MINT, protocolPda);
      const afterFeeReceiverBalance = await getTokenBalance(connection, WSOL_MINT, feeReceiver.publicKey);
      assert.equal(beforeProtocolBalance - afterProtocolBalance, smallFee * LAMPORTS_PER_SOL, 'The protocol balance should decrease by the amount of fee');
      assert.equal(afterFeeReceiverBalance - beforeFeeReceiverBalance, smallFee * LAMPORTS_PER_SOL, 'The fee receiver balance should increase by the amount of fee');
    })

    it('Should withdraw total fee successfully', async () => {
      const withdrawTotalFeeIns = await createReceiverAtaIfNeededAndWithdrawTotalFeeInstruction({
        connection: connection,
        token: WSOL_MINT,
        receiverPubkey: feeReceiver.publicKey,
        signer: operator.publicKey,
        amount: null,
      });
      const beforeProtocolBalance = await getTokenBalance(connection, WSOL_MINT, protocolPda);
      const beforeFeeReceiverBalance = await getTokenBalance(connection, WSOL_MINT, feeReceiver.publicKey);
      const transaction = new Transaction().add(...withdrawTotalFeeIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [operator], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const afterProtocolBalance = await getTokenBalance(connection, WSOL_MINT, protocolPda);
      const afterFeeReceiverBalance = await getTokenBalance(connection, WSOL_MINT, feeReceiver.publicKey);
      assert.equal(beforeProtocolBalance - afterProtocolBalance, (feeAmount - smallFee) * 10**9, 'The protocol balance should decrease by the amount of fee');
      assert.equal(afterFeeReceiverBalance - beforeFeeReceiverBalance, (feeAmount - smallFee) * 10**9, 'The fee receiver balance should increase by the amount of fee');
    })
  });
});

