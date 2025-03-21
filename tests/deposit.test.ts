import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { OptimexSolSmartcontract } from '../target/types/optimex_sol_smartcontract';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import { expect, assert } from 'chai';
import { airdropTokenToUser, createAccount, createTokenPair, getBlockTime, getTokenBalance, sleep } from './utils';
import { keccak256, toUtf8Bytes } from 'ethers';
import _ from 'lodash';
import { solverAddress } from './example-data';
import {
  createMint,
} from '@solana/spl-token';
import { bigintToBytes32, DepositInstructionParam, encodeAddress, getProtocolPda, getUserTradeDetailPda, getVaultPda, TradeInput, TradeDetailInput, parseEtherToBytes32 } from '../solana-js/dist';
import { createInitializeProgramInstructions } from '../solana-js/instructions/intialize';
import { createDepositAndVaultAtaIfNeededAndNonceAccountInstructions } from '../solana-js/instructions/deposit';
import { createAddOperatorInstruction } from '../solana-js/instructions/manage_operator';
import { WSOL_MINT } from '../solana-js/constants';
import { createAddOrUpdateWhitelistInstruction } from '../solana-js/instructions/manage_config';
import { getNonceCheckPda, getTradeVaultPda, getWhitelistPda } from '../solana-js/pda/get_pda_address';
import { getTradeInput } from '../solana-js/utils/param_utils';
import { getTradeDetailData } from '../solana-js/pda/get_pda_data';
import { delay } from '../scripts/utils/helper';

dotenv.config();

describe('Deposit () functional testing', () => {
  // Configure the client to use the local cluster.
  const anchorProvider = anchor.AnchorProvider.env();
  const connection = anchorProvider.connection;
  anchor.setProvider(anchorProvider);

  const program = anchor.workspace
    .OptimexSolSmartcontract as Program<OptimexSolSmartcontract>;

  const deployer = (anchorProvider.wallet as anchor.Wallet).payer;
  const operator = Keypair.generate();
  const user = Keypair.generate();
  const vaultPda = getVaultPda();
  const protocolPda = getProtocolPda();
  let rentForSpace8: number;


  describe('Setup program', async () => {
    it('Deploy init success', async () => {
      const instructions = await createInitializeProgramInstructions({ signer: deployer.publicKey, connection, admin: deployer.publicKey });
      const transaction = new Transaction().add(...instructions);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }

      await connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.requestAirdrop(operator.publicKey, 10 * LAMPORTS_PER_SOL);
      // Get rent for space 8, each empty (such as TradeVault) need 8 bytes discriminator for rent
      rentForSpace8 = await connection.getMinimumBalanceForRentExemption(8);
      await delay(3000);
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
        amount: 0.001 * LAMPORTS_PER_SOL,
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

  });

  describe('Deposit() with SOL', () => {
    const [fromToken, toToken] = createTokenPair();
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const mpcKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const amount = 0.1 * LAMPORTS_PER_SOL;
    let correctTradeInput: TradeInput;
    let correctTradeId: string;
    let correctDepositAmount: BigInt | number;
    let correctTradeDetail: TradeDetailInput;
    let correctTradeIdBytes: number[];
    let correctUserTradeDetail: PublicKey;
    let depositParam: DepositInstructionParam;
    let whitelistToken: PublicKey;
    before(async () => {
      depositParam = {
        sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpcKey.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        amount,
        connection,
        scriptTimeout: await getBlockTime(connection) + 30,
        fromToken,
        toToken,
        toUserAddress: '0x629C473e0E698FD101496E5fbDA4bcB58DA78dC4',
        solver: solverAddress,
        refundPubkey: refundKey.publicKey,
      };
      ({ tradeInput: correctTradeInput, tradeId: correctTradeId, amount: correctDepositAmount } = await getTradeInput(depositParam));

      correctTradeDetail = {
        timeout: new anchor.BN(Math.floor(Date.now() / 1000) + 3000),
        mpcPubkey: mpcKey.publicKey,
        refundPubkey: refundKey.publicKey,
      };

      correctTradeIdBytes = bigintToBytes32(BigInt(correctTradeId));
      correctUserTradeDetail = getUserTradeDetailPda(correctTradeId);
      whitelistToken = getWhitelistPda(WSOL_MINT);

    })

    it('Should fail when signer does not match fromUserAddress', async () => {
      const fromChain = correctTradeInput.tradeInfo.fromChain;
      const newFromChain = fromChain.slice(0);
      newFromChain[0] = Buffer.from(encodeAddress(Keypair.generate().publicKey.toString(), fromToken) as any);
      const tradeInput = {
        ...correctTradeInput,
        tradeInfo: {
          ...correctTradeInput.tradeInfo,
          fromChain: newFromChain,
        }
      }

      try {
        await program.methods
          .deposit({
            data: correctTradeDetail,
            input: tradeInput,
            tradeId: correctTradeIdBytes,
          })
          .accounts({
            signer: user.publicKey,
            userTradeDetail: correctUserTradeDetail,
            ephemeralAccount: userEphemeralKey.publicKey,
            whitelistToken,
            vault: getTradeVaultPda(correctTradeId),
          })
          .signers([userEphemeralKey, user])
          .rpc();
        assert.fail('Should not reach here');
      } catch (error) {
        assert(error.toString().includes('Unauthorized'));
      }
    });


    it('Should fail when timeout is in the past', async () => {
      const tradeDetail: TradeDetailInput = {
        ...correctTradeDetail,
        timeout: new anchor.BN(Math.floor(Date.now() / 1000) - 1000), // Time in the past
      };

      try {
        await program.methods
          .deposit({
            data: tradeDetail,
            input: correctTradeInput,
            tradeId: correctTradeIdBytes,
          })
          .accounts({
            signer: user.publicKey,
            userTradeDetail: correctUserTradeDetail,
            ephemeralAccount: userEphemeralKey.publicKey,
            whitelistToken,
            vault: getTradeVaultPda(correctTradeId),
          })
          .signers([userEphemeralKey, user])
          .rpc();
        assert.fail('Should not reach here');
      } catch (error) {
        assert(error.toString().includes('InvalidTimeout'));
      }
    });

    it('Should fail when amount is zero', async () => {
      const newTradeInput = {
        ...correctTradeInput,
        tradeInfo: {
          ...correctTradeInput.tradeInfo,
          amountIn: parseEtherToBytes32('0'),
        }
      }
      try {
        await program.methods
          .deposit({
            data: correctTradeDetail,
            input: newTradeInput,
            tradeId: correctTradeIdBytes,
          })
          .accounts({
            signer: user.publicKey,
            userTradeDetail: correctUserTradeDetail,
            ephemeralAccount: userEphemeralKey.publicKey,
            whitelistToken,
            vault: getTradeVaultPda(correctTradeId),
          })
          .signers([userEphemeralKey, user])
          .rpc();
        assert.fail('Should not reach here')
      } catch (error) {
        assert(error.toString().includes('DepositZeroAmount'));
      }
    });


    it('Should fail when tradeId off-chain does not match with tradeId on-chain', async () => {
      const toChain = correctTradeInput.tradeInfo.toChain;
      const newToChain = toChain.slice(0);
      // Change a field in toChain to make new tradeId
      newToChain[0] = Buffer.from(encodeAddress('0x9fc3da866e7df3a1c57ade1a97c9f00a70f010c8', toToken) as any);
      const tradeInput = {
        ...correctTradeInput,
        tradeInfo: {
          ...correctTradeInput.tradeInfo,
          toChain: newToChain,
        }
      }
      try {
        await program.methods
          .deposit({
            data: correctTradeDetail,
            input: tradeInput,
            tradeId: correctTradeIdBytes,
          })
          .accounts({
            signer: user.publicKey,
            userTradeDetail: correctUserTradeDetail,
            ephemeralAccount: userEphemeralKey.publicKey,
            whitelistToken,
            vault: getTradeVaultPda(correctTradeId),
          })
          .signers([userEphemeralKey, user])
          .rpc();
        assert.fail('Should not reach here')
      } catch (error) {
        assert(error.toString().includes('InvalidTradeId'));
      }
    });

    it(`Deposit succeed`, async () => {
      const depositIns = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParam);
      const { tradeId } = await getTradeInput(depositParam);
      const vaultPda = getTradeVaultPda(tradeId);
      const beforeVaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      const transaction = new Transaction().add(...depositIns);
      const beforeUserBalance = await connection.getBalance(user.publicKey, 'confirmed');
      try {
        // console.log('Correct user trade detail', correctUserTradeDetail.toBase58());
        await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
      const userTradeDetailData = await getTradeDetailData(tradeId, connection);
      assert.equal(userTradeDetailData.amount.toString(), correctDepositAmount.toString(), 'Deposit amount invalid');
      assert.equal(userTradeDetailData.mpcPubkey.toBase58(), mpcKey.publicKey.toBase58(), 'MPC pubkey invalid');
      assert.equal(userTradeDetailData.refundPubkey.toBase58(), refundKey.publicKey.toBase58(), 'Refund pubkey invalid');
      assert.equal(userTradeDetailData.userPubkey.toBase58(), user.publicKey.toBase58(), 'User pubkey invalid');
      assert.equal(userTradeDetailData.userEphemeralPubkey.toBase58(), userEphemeralKey.publicKey.toBase58(), 'User ephemeral pubkey invalid');
      assert.isNull(userTradeDetailData.token, 'Token mint invalid');

      const afterVaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      assert.equal(afterVaultBalance - beforeVaultBalance, Number(amount) + rentForSpace8, 'Vault balance invalid');
      const userTradeDetailBalance = await connection.getBalance(correctUserTradeDetail, 'confirmed');
      const afterUserBalance = await connection.getBalance(user.publicKey, 'confirmed');
      const userEphemeralBalance = await connection.getBalance(userEphemeralKey.publicKey, 'confirmed');
      const nonceCheckPda = getNonceCheckPda(userEphemeralKey.publicKey);
      const nonceCheckPdaBalance = await connection.getBalance(nonceCheckPda, 'confirmed');
      const vaultPdaBalance = await connection.getBalance(vaultPda, 'confirmed');
      assert.equal(beforeUserBalance - afterUserBalance, nonceCheckPdaBalance + userTradeDetailBalance + vaultPdaBalance + userEphemeralBalance, 'User balance invalid');
    });

    it(`Should fail when user ephemeral key alread exists`, async () => {
      const newSessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
      // New session ID generate new tradeId
      const newDepositParam = {
        ...depositParam,
        sessionId: newSessionId,
      }

      const noncePda = getNonceCheckPda(userEphemeralKey.publicKey);

      const depositIns = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(newDepositParam);
      const transaction = new Transaction().add(...depositIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey], { commitment: 'confirmed' });
      } catch (error) {
        assert(error.transactionLogs.some(log => log.includes(`${noncePda.toBase58()}`) && log.includes('already in use')));
      }
    })
  });

  describe('Deposit() with Token', () => {
    let mint = Keypair.generate();
    const tokenMint = mint.publicKey;
    const [fromToken, toToken] = createTokenPair(tokenMint.toBase58());
    const userEphemeralKey = Keypair.generate();
    const tokenUnit = 10 ** 8;
    const refundKey = Keypair.generate();
    const mpcKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const amount = 0.1 * tokenUnit;
    let correctTradeInput: TradeInput;
    let correctTradeId: string;
    let correctDepositAmount: BigInt | number;
    let correctTradeDetail: TradeDetailInput;
    let correctTradeIdBytes: number[];
    let correctUserTradeDetail: PublicKey;
    let depositParam: DepositInstructionParam;
    let whitelistToken: PublicKey;
    before(async () => {
      await createMint(
        connection,
        deployer,
        deployer.publicKey,
        null,
        8,
        mint,
        { commitment: 'confirmed' }
      );

      depositParam = {
        sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpcKey.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        amount,
        connection,
        scriptTimeout: await getBlockTime(connection) + 30,
        fromToken,
        toToken,
        toUserAddress: '0x629C473e0E698FD101496E5fbDA4bcB58DA78dC4',
        solver: solverAddress,
        refundPubkey: refundKey.publicKey,
      };
      ({ tradeInput: correctTradeInput, tradeId: correctTradeId, amount: correctDepositAmount } = await getTradeInput(depositParam));

      correctTradeDetail = {
        timeout: new anchor.BN(Math.floor(Date.now() / 1000) + 3000),
        mpcPubkey: mpcKey.publicKey,
        refundPubkey: refundKey.publicKey,
      };

      correctTradeIdBytes = bigintToBytes32(BigInt(correctTradeId));
      correctUserTradeDetail = getUserTradeDetailPda(correctTradeId);
      whitelistToken = getWhitelistPda(tokenMint);
      await airdropTokenToUser(connection, tokenMint, deployer, user.publicKey, 1000 * tokenUnit)

      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: tokenMint,
        amount: 0.001 * LAMPORTS_PER_SOL,
        connection,
      });
      const addWhitelistTransaction = new Transaction().add(...addWhitelistIns);
      await sendAndConfirmTransaction(connection, addWhitelistTransaction, [operator], { commitment: 'confirmed' });
    })

    it('Deposit failed because of invalid whitelist amount', async () => {
      const newDepositParam = {
        ...depositParam,
        amount: 0.0001 * tokenUnit, 
      }
      const depositIns = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(newDepositParam);
      const transaction = new Transaction().add(...depositIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString().includes('InvalidAmount'));
      }
    })


    it(`Deposit succeed`, async () => {
      const depositIns = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParam);
      const vaultPda = getTradeVaultPda(correctTradeId);
      const beforeVaultBalance = await getTokenBalance(connection, tokenMint, vaultPda);
      const transaction = new Transaction().add(...depositIns);
      const beforeUserBalance = await getTokenBalance(connection, tokenMint, user.publicKey);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
      const userTradeDetailData = await getTradeDetailData(correctTradeId, connection);
      assert.equal(userTradeDetailData.amount.toString(), correctDepositAmount.toString(), 'Deposit amount invalid');
      assert.equal(userTradeDetailData.mpcPubkey.toBase58(), mpcKey.publicKey.toBase58(), 'MPC pubkey invalid');
      assert.equal(userTradeDetailData.refundPubkey.toBase58(), refundKey.publicKey.toBase58(), 'Refund pubkey invalid');
      assert.equal(userTradeDetailData.userPubkey.toBase58(), user.publicKey.toBase58(), 'User pubkey invalid');
      assert.equal(userTradeDetailData.userEphemeralPubkey.toBase58(), userEphemeralKey.publicKey.toBase58(), 'User ephemeral pubkey invalid');
      assert.equal(userTradeDetailData.token.toBase58(), tokenMint.toBase58(), 'Token mint invalid');

      const afterVaultBalance = await getTokenBalance(connection, tokenMint, vaultPda);
      assert.equal(afterVaultBalance - beforeVaultBalance, Number(amount), 'Vault balance invalid');
      const afterUserBalance = await getTokenBalance(connection, tokenMint, user.publicKey);
      assert.equal(beforeUserBalance - afterUserBalance, Number(amount), 'User balance invalid');
    });

    it(`Deposit failed because of not whitelisted token`, async () => {
      const newMint = Keypair.generate();
      const userEphemeralKey = Keypair.generate();
      await createMint(connection, deployer, deployer.publicKey, null, 8, newMint, { commitment: 'confirmed' });
      const newTokenMint = newMint.publicKey;
      const [fromToken, toToken] = createTokenPair(newTokenMint.toBase58());
      const newDepositParam = {
        ...depositParam,
        fromToken,
      }
      const { tradeInput, tradeId, amount } = await getTradeInput(newDepositParam);
      const tradeIdBytes = bigintToBytes32(BigInt(tradeId));
      const tradeDetail = {
        timeout: new anchor.BN(Math.floor(Date.now() / 1000) + 3000),
        mpcPubkey: mpcKey.publicKey,
        refundPubkey: refundKey.publicKey,
      };
      const userTradeDetail = getUserTradeDetailPda(tradeId);
      try {
        await program.methods
          .deposit({
            data: tradeDetail,
            input: tradeInput,
            tradeId: tradeIdBytes,
          })
          .accounts({
            signer: user.publicKey,
            userTradeDetail,
            ephemeralAccount: userEphemeralKey.publicKey,
            whitelistToken,
            vault: getTradeVaultPda(tradeId),
          })
          .signers([userEphemeralKey, user])
          .rpc();
        assert.fail('Should not reach here');
      } catch (error) {
        assert(error.toString().includes('NotWhitelistedToken'));
      }
    })
  });
});
