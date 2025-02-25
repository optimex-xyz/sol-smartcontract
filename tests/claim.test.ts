import * as anchor from '@coral-xyz/anchor';
import { PetaFiSolSmartcontract } from '../target/types/peta_fi_sol_smartcontract';
import {
  AccountMeta,
  Keypair,
  LAMPORTS_PER_SOL,
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import { expect, assert } from 'chai';
import { airdropTokenToUser, createTokenPair, getBlockTime, getTokenBalance, sleep } from './utils';
import { keccak256, toUtf8Bytes } from 'ethers';
import { solverAddress } from './example-data';
import {
  createMint,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { bigintToBytes32, DepositInstructionParam, getProtocolPda, getTradeInput,  getVaultPda, TradeInput } from '../petafi-solana-js';
import { delay } from '../scripts/utils/helper';
import { createDepositAndVaultAtaIfNeededAndNonceAccountInstructions } from '../petafi-solana-js/instructions/deposit';
import { createInitializePetaFiInstructions } from '../petafi-solana-js/instructions/intialize';
import { createAddOperatorInstruction } from '../petafi-solana-js/instructions/manage_operator';
import { createAddOrUpdateWhitelistInstruction } from '../petafi-solana-js/instructions/manage_config';
import { createClaimAndRefundAtaAndProtocolAtaIfNeededInstructions } from '../petafi-solana-js/instructions/claim';
import { WSOL_MINT } from '../petafi-solana-js/constants';
import { getNonceCheckPda, getTradeVaultPda, getUserTradeDetailPda } from '../petafi-solana-js/pda/get_pda_address';
import { getTradeDetailData } from '../petafi-solana-js/pda/get_pda_data';

dotenv.config();

describe('Claim() functional testing', () => {
  // Configure the client to use the local cluster.
  const anchorProvider = anchor.AnchorProvider.env();
  anchor.setProvider(anchorProvider);

  const program = anchor.workspace
    .PetaFiSolSmartcontract as anchor.Program<PetaFiSolSmartcontract>;

  const connection = anchorProvider.connection;
  const deployer = (anchorProvider.wallet as anchor.Wallet).payer;
  const user = Keypair.generate();
  const mpcKey = Keypair.generate();
  const protocolPda = getProtocolPda();
  const operator = Keypair.generate();


  describe('Setup program', async () => {
    it('Deploy init success', async () => {
      const instructions = await createInitializePetaFiInstructions({ signer: deployer.publicKey, connection, admin: deployer.publicKey });
      const transaction = new Transaction().add(...instructions);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }

      await connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.requestAirdrop(mpcKey.publicKey, 10 * LAMPORTS_PER_SOL);
      const sig = await connection.requestAirdrop(operator.publicKey, 10 * LAMPORTS_PER_SOL);
    })

    it('Add operator successfully', async () => {
      const addOperatorIns = await createAddOperatorInstruction({
        signer: deployer.publicKey,
        operator: operator.publicKey,
        connection: connection,
      });
      const transaction = new Transaction().add(...addOperatorIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
    })
  })

  describe('Claim with SOL()', () => {
    const [fromToken, toToken] = createTokenPair();
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const amount = '0.1';
    let correctTradeId: string;
    let correctTradeIdBytes: number[];
    let correctUserTradeDetail: PublicKey;
    let depositParam: DepositInstructionParam;
    before(async () => {
      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: WSOL_MINT,
        amount: '0.001',
        connection: connection,
      });
      const addWhitelistTransaction = new Transaction().add(...addWhitelistIns);
      await sendAndConfirmTransaction(connection, addWhitelistTransaction, [operator], { commitment: 'confirmed' });

      depositParam = {
        sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpcKey.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        amount,
        connection,
        scriptTimeout: await getBlockTime(connection) + 3,
        fromToken,
        toToken,
        toUserAddress: '0x629C473e0E698FD101496E5fbDA4bcB58DA78dC4',
        solver: solverAddress,
        refundPubkey: refundKey.publicKey,
      };
      ({ tradeId: correctTradeId } = await getTradeInput(depositParam));

      correctTradeIdBytes = bigintToBytes32(BigInt(correctTradeId));
      correctUserTradeDetail = getUserTradeDetailPda(correctTradeId);

      const depositIns = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParam);
      const transaction = new Transaction().add(...depositIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
    })

    it('Should failed when claim before timeout', async () => {
      try {
        await program.methods
          .claim({ tradeId: correctTradeIdBytes })
          .accounts({
            signer: user.publicKey,
            userTradeDetail: correctUserTradeDetail,
            refundAccount: refundKey.publicKey,
            userAccount: user.publicKey,
          })
      } catch (error) {
        expect(error.toString()).to.include('ClaimNotAvailable');
      }
    })

    it('Should failed when mismatch user pubkey', async () => {
      try {
        await program.methods
        .claim({ tradeId: correctTradeIdBytes })
        .accounts({
          signer: user.publicKey,
          userTradeDetail: correctUserTradeDetail,
          refundAccount: refundKey.publicKey,
          userAccount: Keypair.generate().publicKey,
        })
      } catch (error) {
        expect(error.toString()).to.include('InvalidUserAccount');
      }
    });

    it('Should failed when mismatch refund pubkey', async () => {
      try {
        await program.methods
          .claim({ tradeId: correctTradeIdBytes })
          .accounts({
            signer: user.publicKey,
            userTradeDetail: correctUserTradeDetail,
            refundAccount: Keypair.generate().publicKey,
            userAccount: refundKey.publicKey,
          })
      } catch (error) {
        expect(error.toString()).to.include('InvalidRefundPubkey');
      }
    })

    it('Should claim successfully', async () => {
      await delay(5000);
      const vaultPda = getTradeVaultPda(correctTradeId);
      const beforeVaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      const beforeRefundBalance = await connection.getBalance(refundKey.publicKey, 'confirmed');
      const beforeUserBalance = await connection.getBalance(user.publicKey, 'confirmed');
      const tradeDetailBalance = await connection.getBalance(correctUserTradeDetail, 'confirmed');
      const nonceCheckAccount = getNonceCheckPda(userEphemeralKey.publicKey);
      const nonceCheckAccountBalance = await connection.getBalance(nonceCheckAccount, 'confirmed');
      const claimIns = await createClaimAndRefundAtaAndProtocolAtaIfNeededInstructions({
        tradeId: correctTradeId,
        connection: connection,
        userPubkey: user.publicKey,
      });
      const transaction = new Transaction().add(...claimIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
      const afterVaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      const afterRefundBalance = await connection.getBalance(refundKey.publicKey, 'confirmed');
      const afterUserBalance = await connection.getBalance(user.publicKey, 'confirmed');
      assert.equal(beforeVaultBalance - afterVaultBalance, Number(amount) * LAMPORTS_PER_SOL, 'Vault balance should be decreased by the amount of SOL claimed');
      assert.equal(afterRefundBalance - beforeRefundBalance, Number(amount) * LAMPORTS_PER_SOL, 'User balance should be increased by the amount of SOL claimed');
      assert.equal(afterUserBalance - beforeUserBalance, nonceCheckAccountBalance, 'User balance should be increased by the amount of SOL account deleted');

      const userTradeDetailData = await getTradeDetailData(correctTradeId, connection);
      assert.isObject(userTradeDetailData.status.claimed, 'User trade detail status should be claimed');
    });


    it('Should claim failed with already claimed, InvalidTradeStatus', async () => {
      const newDepositParam = {
        ...depositParam,
        sessionId: BigInt(keccak256(toUtf8Bytes(crypto.randomUUID()))),
        scriptTimeout: await getBlockTime(connection) + 20,
      };
      const nonceLamports = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
      const withdrawNonceIns = await SystemProgram.nonceWithdraw({
        noncePubkey: depositParam.userEphemeralPubkey,
        authorizedPubkey: mpcKey.publicKey,
        toPubkey: user.publicKey,
        lamports: nonceLamports,
      })
      const nonceWithdrawTransaction = new Transaction().add(withdrawNonceIns);
      const depositIns = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(newDepositParam);
      const depositTransaction = new Transaction().add(...depositIns);
      try {
        // Sleep until deposit is finalized
        nonceWithdrawTransaction.feePayer = mpcKey.publicKey;
        await sendAndConfirmTransaction(connection, nonceWithdrawTransaction, [mpcKey], { commitment: 'confirmed' });
        // Need to wait 10 second until nonce is closed, because nonce is required to be finalized to be processed
        await sleep(10000);
        await sendAndConfirmTransaction(connection, depositTransaction, [user, userEphemeralKey], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
      const claimIns = await createClaimAndRefundAtaAndProtocolAtaIfNeededInstructions({
        tradeId: correctTradeId,
        connection: connection,
        userPubkey: user.publicKey,
      });
      const transaction = new Transaction().add(...claimIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user], { commitment: 'confirmed' });
      } catch (error) {
        assert.isTrue(error.toString().includes('InvalidTradeStatus'));
      }
    });
  });


  describe('Claim with token', async () => {
    const mint = Keypair.generate();
    const tokenMint = mint.publicKey;
    const [fromToken, toToken] = createTokenPair(mint.publicKey.toBase58());
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const amount = '0.1';
    const tokenUnit = 10 ** 8;
    let correctTradeId: string;
    let correctTradeIdBytes: number[];
    let correctUserTradeDetail: PublicKey;
    let depositParam: DepositInstructionParam;
    let userProtocolPda: PublicKey;
    let remainingAccounts: AccountMeta[] = [];
    let vaultPda: PublicKey;
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
      await airdropTokenToUser(connection, tokenMint, deployer, user.publicKey, 10 * tokenUnit);

      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: tokenMint,
        amount: '0.001',
        connection: connection,
      });

      const addWhitelistTransaction = new Transaction().add(...addWhitelistIns);
      await sendAndConfirmTransaction(connection, addWhitelistTransaction, [operator], { commitment: 'confirmed' });
      depositParam = {
        sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpcKey.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        amount,
        connection,
        scriptTimeout: await getBlockTime(connection) + 2,
        fromToken,
        toToken,
        toUserAddress: '0x629C473e0E698FD101496E5fbDA4bcB58DA78dC4',
        solver: solverAddress,
        refundPubkey: refundKey.publicKey,
      };
      ({ tradeId: correctTradeId } = await getTradeInput(depositParam));

      correctTradeIdBytes = bigintToBytes32(BigInt(correctTradeId));
      correctUserTradeDetail = getUserTradeDetailPda(correctTradeId);

      vaultPda = getTradeVaultPda(correctTradeId);

      const depositIns = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParam);
      const transaction = new Transaction().add(...depositIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }

      remainingAccounts.push({
        pubkey: TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: tokenMint,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: await getAssociatedTokenAddress(tokenMint, vaultPda, true),
        isSigner: false,
        isWritable: true,
      },{
        pubkey: await getAssociatedTokenAddress(tokenMint, refundKey.publicKey, true),
        isSigner: false,
        isWritable: true,
      }
    )
    await delay(5000);
    });

    it('Should failed when mismatch mint account', async () => {
      const newRemainingAccounts = [...remainingAccounts];
      // Pass invalid mint account
      newRemainingAccounts[1] = {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: false,
      }
      try {
        await program.methods.claim({ tradeId: correctTradeIdBytes })
        .accounts({
          signer: user.publicKey,
          userTradeDetail: correctUserTradeDetail,
          refundAccount: refundKey.publicKey,
          userAccount: user.publicKey,
          vault: vaultPda,
        })
        .remainingAccounts(newRemainingAccounts)
        .signers([user])
        .rpc({ commitment: 'confirmed' })
      } catch (error) {
        expect(error.toString()).to.include('InvalidMintKey');
      }
    })

    it('Should failed when mismatch source account', async () => {
      const newRemainingAccounts = [...remainingAccounts];
      // Pass invalid mint account
      newRemainingAccounts[2] = {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: false,
      }
      try {
        await program.methods.claim({ tradeId: correctTradeIdBytes })
        .accounts({
          signer: user.publicKey,
          userTradeDetail: correctUserTradeDetail,
          refundAccount: refundKey.publicKey,
          userAccount: user.publicKey,
          vault: vaultPda,
        })
        .remainingAccounts(newRemainingAccounts)
        .signers([user])
        .rpc({ commitment: 'confirmed' })
      } catch (error) {
        expect(error.toString()).to.include('InvalidSourceAta');
      }
    })

    it('Should failed when mismatch destination account', async () => {
      const newRemainingAccounts = [...remainingAccounts];
      // Pass invalid mint account
      newRemainingAccounts[3] = {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: false,
      }
      try {
        await program.methods.claim({ tradeId: correctTradeIdBytes })
        .accounts({
          signer: user.publicKey,
          userTradeDetail: correctUserTradeDetail,
          refundAccount: refundKey.publicKey,
          userAccount: user.publicKey,
          vault: vaultPda,
        })
        .remainingAccounts(newRemainingAccounts)
        .signers([user])
        .rpc({ commitment: 'confirmed' })
      } catch (error) {
        expect(error.toString()).to.include('InvalidDestinationAta');
      }
    })

    it('Should success', async () => {
      const beforeVaultBalance = await getTokenBalance(connection, tokenMint, vaultPda);
      const beforeRefundBalance = await getTokenBalance(connection, tokenMint, refundKey.publicKey);
      const claimIns = await createClaimAndRefundAtaAndProtocolAtaIfNeededInstructions({
        tradeId: correctTradeId,
        connection: connection,
        userPubkey: user.publicKey,
      });
      const transaction = new Transaction().add(...claimIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }

      const afterVaultBalance = await getTokenBalance(connection, tokenMint, vaultPda);
      const afterRefundBalance = await getTokenBalance(connection, tokenMint, refundKey.publicKey);
      assert.equal(beforeVaultBalance - afterVaultBalance, Number(amount) * tokenUnit, 'Vault balance should be decreased by the amount of token claimed');
      assert.equal(afterRefundBalance - beforeRefundBalance, Number(amount) * tokenUnit, 'Refund balance should be increased by the amount of token claimed');
    })
  })
});
