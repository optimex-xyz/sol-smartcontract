import { BorshCoder, Instruction, ProgramAccount } from '@coral-xyz/anchor';
import { Connection, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { createAddFeeReceiverInstruction, createAddOrUpdateWhitelistInstruction, createAssociatedTokenAccountInstructionIfNeeded, createRemoveFeeReceiverInstruction, createRemoveWhitelistInstruction, createWithdrawTotalFeeInstruction, getOptimexProgram, getConfigPda, getProtocolPda, getWhitelistPda, PaymentReceipt, TradeDetail, tradeIdBytesToString, createInitializeProgramInstructions, createAddOperatorInstruction, createRemoveOperatorInstruction, createSetCloseWaitDurationInstruction } from "../../solana-js";
import { Command, Option } from 'commander';
import { getKeypairFromFile } from '../utils/helper';
import bs58 from 'bs58';

const program = new Command();

const commonOptions = [
    new Option('-u, --url <string>', 'The network url, devnet default').default('https://api.devnet.solana.com'),
    new Option('--commitment <string>', 'The commitment level').default('confirmed')
]

program.command('initialize')
.description('Initialize the optimex program')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.requiredOption('--authority <string>', 'The path to authority keypair, who is the deployer of the program')
.requiredOption('--admin <string>', 'The address of admin')
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const authorityKeypair = await getKeypairFromFile(options.authority);
    const adminPubkey = new PublicKey(options.admin);
    const createInitializeInstruction = await createInitializeProgramInstructions({
        signer: authorityKeypair.publicKey,
        admin: adminPubkey,
        connection,
    })

    console.log(`Start to initialize program`);
    try {
        const transaction = new Transaction().add(...createInitializeInstruction);
        const txHash = await sendAndConfirmTransaction(connection, transaction, [authorityKeypair], commitment);
        console.log(`Initialize program success tx hash: ${txHash}`);
    } catch (error) {
        console.log('Initialize program failed');
        console.log(error);
    }
})

const fetchCommand = program.command('fetch')
.description('Fetch account data for from the optimex program')

fetchCommand.command('config')
.description('Fetch the config account')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.action(async (options) => {
    const configPda = getConfigPda();
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const optimexProgram = await getOptimexProgram(connection);
    console.log('Config PDA', configPda.toBase58());
    console.log('Protocol PDA', getProtocolPda().toBase58());
    try {
        const config = await optimexProgram.account.config.fetch(configPda);
        console.log({
            ...config,
            admin: config.admin.toBase58(),
            operators: config.operators.map((operator) => operator.toBase58()),
            closeTradeDuration: config.closeTradeDuration.toString(),
            closePaymentDuration: config.closePaymentDuration.toString(),
        })
    } catch (error) {
        console.error('Fetch config error, maybe the program is not initialized yet');
        console.log(error);
    }
})

fetchCommand.command('trade-detail')
.description('Fetch the trade detail account')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.option('--trade-id <string>', 'The trade id')
.option('--token <string>', 'The token that the trade is made of, native if SOL, address if token')
.option('--status <string>', 'The status of the trade: deposited, settled, claimed')
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const optimexProgram = await getOptimexProgram(connection);
    try {
        // Fetch with specific data size to avoid fetching deprecated accounts
        const tradeDetails = await optimexProgram.account.tradeDetail.all([ { dataSize: optimexProgram.account.tradeDetail.size }])
        let matchedTradeDetail = tradeDetails;
        if (options.tradeId) {
            matchedTradeDetail = matchedTradeDetail.filter((tradeDetail) => tradeIdBytesToString(tradeDetail.account.tradeId) === options.tradeId)
        }
        if (options.token) {
            if (options.token === 'native') {
                matchedTradeDetail = matchedTradeDetail.filter((tradeDetail) => tradeDetail.account.token === null)
            } else {
                matchedTradeDetail = matchedTradeDetail.filter((tradeDetail) => tradeDetail.account.token?.toBase58() === options.token)
            }
        }
        if (options.status) {
            matchedTradeDetail = matchedTradeDetail.filter((tradeDetail) => tradeDetail.account.status[options.status])
        }
        const formattedTradeDetails = matchedTradeDetail.map(formatTradeDetail);
        console.log(`Matched trade ${matchedTradeDetail.length}`)
        console.log(formattedTradeDetails);
    } catch (error) {
        console.error('Fetch trade detail error');
        console.error(error);
    }
})

fetchCommand.command('payment')
.description('Fetch the payment account')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.option('--trade-id <string>', 'The trade id')
.option('--token <string>', 'The token that the payment is made of, native if SOL, address if token')
.option('--from-pubkey <string>', 'The from pubkey of the payment')
.option('--to-pubkey <string>', 'The to pubkey of the payment')
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const optimexProgram = await getOptimexProgram(connection);
    try {
        // Fetch with specific data size to avoid fetching deprecated accounts
        const payments = await optimexProgram.account.paymentReceipt.all([ { dataSize: optimexProgram.account.paymentReceipt.size }])
        let matchedPayments = payments;
        if (options.tradeId) {
            matchedPayments = matchedPayments.filter((payment) => tradeIdBytesToString(payment.account.tradeId) === options.tradeId)
        }
        if (options.token) {
            if (options.token === 'native') {
                matchedPayments = matchedPayments.filter((payment) => payment.account.token === null)
            } else {
                matchedPayments = matchedPayments.filter((payment) => payment.account.token?.toBase58() === options.token)
            }
        }
        if (options.fromPubkey) {
            matchedPayments = matchedPayments.filter((payment) => payment.account.fromPubkey.toBase58() === options.fromPubkey)
        }
        if (options.toPubkey) {
            matchedPayments = matchedPayments.filter((payment) => payment.account.toPubkey.toBase58() === options.toPubkey)
        }
        const formattedPayments = matchedPayments.map(formatPayment);
        console.log(`Matched payment ${matchedPayments.length}`)
        console.log(formattedPayments);
    } catch (error) {
        console.error('Fetch payments error');
        console.error(error);
    }
})

fetchCommand.command('fee-receiver')
.description('Fetch the list of fee receivers')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const optimexProgram = await getOptimexProgram(connection);
    try {
        // Fetch with specific data size to avoid fetching deprecated accounts
        const feeReceivers = await optimexProgram.account.feeReceiver.all([ { dataSize: optimexProgram.account.feeReceiver.size }])
        console.log(`Matched fee receivers ${feeReceivers.length}`)
        for (const feeReceiver of feeReceivers) {
            console.log({
                pubkey: feeReceiver.publicKey.toBase58(),
                account: {
                    receiver: feeReceiver.account.receiver.toBase58(),
                }
            })
        }
    } catch (error) {
        console.error('Fetch fee receivers error');
        console.error(error);
    }
})

fetchCommand.command('whitelist')
.description('Fetch the list of whitelisted tokens')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const optimexProgram = await getOptimexProgram(connection);
    try {
        // Fetch with specific data size to avoid fetching deprecated accounts
        const whitelistedTokens = await optimexProgram.account.whitelistToken.all([ { dataSize: optimexProgram.account.whitelistToken.size }])
        console.log(`Matched whitelisted tokens ${whitelistedTokens.length}`)
        for (const whitelistedToken of whitelistedTokens) {
            console.log({
                pubkey: whitelistedToken.publicKey.toBase58(),
                account: {
                    token: whitelistedToken.account.token.toBase58(),
                    amount: whitelistedToken.account.amount.toString(),
                }
            })
        }
    } catch (error) {
        console.error('Fetch fee receivers error');
        console.error(error);
    }
})

program.command('update-whitelist')
.description('Add or update the whitelisted token, add protocol ata if needed')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.requiredOption('--operator <string>', 'The path to operator keypair')
.requiredOption('--token <string>', 'The token to add or update')
.requiredOption('--amount <string>', 'The amount to set for the whitelisted token, without decimals')
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const operator = await getKeypairFromFile(options.operator);
    const token = new PublicKey(options.token);

    const optimexProgram = await getOptimexProgram(connection);
    const whitelistTokenPda = getWhitelistPda(token);
    const protocolPda = getProtocolPda();
    const createProtocolAtaInstruction = await createAssociatedTokenAccountInstructionIfNeeded(
        connection,
        operator.publicKey,
        token,
        protocolPda,
        commitment,
    )
    const whitelistTokenInfo = await connection.getAccountInfo(whitelistTokenPda, commitment);
    if (whitelistTokenInfo) {
        const whitelistToken = await optimexProgram.account.whitelistToken.fetch(whitelistTokenPda);
        console.log(`Update whitelisted for token ${whitelistToken.token.toBase58()} from ${whitelistToken.amount.toString()} to ${options.amount}`)
    } else {
        console.log(`Set whitelisted for token ${token.toBase58()} with amount ${options.amount}`)
    }
    const addOrUpdateWhitelistInstruction = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token,
        amount: BigInt(options.amount),
        connection: connection,
    })

    try {
        const transaction = new Transaction().add(...addOrUpdateWhitelistInstruction, ...createProtocolAtaInstruction);
        const txHash = await sendAndConfirmTransaction(connection, transaction, [operator], commitment);
        console.log(`Update whitelisted token with tx hash: ${txHash}`);
    } catch (error) {
        console.error('Update whitelisted token error');
        throw error;
    }
})

program.command('add-receiver')
.description('Add the receiver')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.requiredOption('--admin <string>', 'The path to admin keypair')
.requiredOption('--fee-receiver <string>', 'The fee receiver address')
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const admin = await getKeypairFromFile(options.admin);

    const addFeeReceiverInstruction = await createAddFeeReceiverInstruction({
        connection, 
        signer: admin.publicKey,
        receiver: new PublicKey(options.feeReceiver),
    })

    try {
        const transaction = new Transaction().add(...addFeeReceiverInstruction);
        const txHash = await sendAndConfirmTransaction(connection, transaction, [admin], commitment);
        console.log(`Add fee receiver success tx hash: ${txHash}`);
    } catch (error) {
        console.error('Add fee receiver failed');
        throw error;
    }
})

program.command('remove-receiver')
.description('Remove the receiver')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.requiredOption('--admin <string>', 'The path to admin keypair')
.requiredOption('--fee-receiver <string>', 'The fee receiver address')
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const admin = await getKeypairFromFile(options.admin);

    const removeFeeReceiver = await createRemoveFeeReceiverInstruction({
        connection, 
        signer: admin.publicKey,
        receiver: new PublicKey(options.feeReceiver),
    })

    try {
        const transaction = new Transaction().add(...removeFeeReceiver);
        const txHash = await sendAndConfirmTransaction(connection, transaction, [admin], commitment);
        console.log(`Remove fee receiver success tx hash: ${txHash}`);
    } catch (error) {
        console.error('Remove fee receiver failed');
        throw error;
    }
})

program.command('remove-whitelist')
.description('Remove the whitelisted token')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.requiredOption('--operator <string>', 'The path to operator keypair')
.requiredOption('--token <string>', 'The token to add or update')
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const operator = await getKeypairFromFile(options.operator);
    const token = new PublicKey(options.token);

    const optimexProgram = await getOptimexProgram(connection);
    const whitelistTokenPda = getWhitelistPda(token);
    const whitelistTokenInfo = await connection.getAccountInfo(whitelistTokenPda, commitment);
    if (whitelistTokenInfo) {
        await optimexProgram.account.whitelistToken.fetch(whitelistTokenPda);
        console.log(`Remove whitelisted for token ${token.toBase58()}`)
    } else {
        throw new Error(`Token ${token.toBase58()} is not whitelisted`)
    }
    const removeWhitelistInstruction = await createRemoveWhitelistInstruction({
        operator: operator.publicKey,
        token,
        connection: connection,
    })

    try {
        const transaction = new Transaction().add(...removeWhitelistInstruction);
        const txHash = await sendAndConfirmTransaction(connection, transaction, [operator], commitment);
        console.log(`Remove whitelisted token with tx hash: ${txHash}`);
    } catch (error) {
        console.error('Remove whitelisted token error');
        throw error;
    }
})

program.command('withdraw-fee')
.description('Withdraw total fee')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.requiredOption('--token <string>', 'The asset address we want to withdraw, native if SOL')
.requiredOption('--authorizer <string>', 'The path to the authorizer')
.requiredOption('--fee-receiver <string>', 'The fee receiver address')
.action(async (options) => {
    console.log('Options ', options);
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const authorizer = await getKeypairFromFile(options.authorizer);
    const feeReceiver = new PublicKey(options.feeReceiver);
    const token = options.token === 'native' ? null : new PublicKey(options.token)

    const createFeeReceiverAtaInstruction = await createAssociatedTokenAccountInstructionIfNeeded(
        connection,
        authorizer.publicKey,
        token,
        feeReceiver, 
    )
    const withdrawFeeInstruction = await createWithdrawTotalFeeInstruction({
        connection,
        signer: authorizer.publicKey,
        token,
        receiverPubkey: feeReceiver,
        amount: null,
    })

    const transaction = new Transaction().add(...createFeeReceiverAtaInstruction, ...withdrawFeeInstruction);

    try {
        const txHash = await sendAndConfirmTransaction(connection, transaction, [authorizer], commitment);
        console.log(`Withdraw fee success tx hash: ${txHash}`);
    } catch (error) {
        console.error('Withdraw fee failed');
        throw error;
    }
})

program.command('add-operator')
.description('Add the operator')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.requiredOption('--admin <string>', 'The path to admin keypair')
.requiredOption('--operator <string>', 'The operator address')
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const admin = await getKeypairFromFile(options.admin);
    const operator = new PublicKey(options.operator);

    const addOperatorInstruction = await createAddOperatorInstruction({
        connection,
        signer: admin.publicKey,
        operator,
    })

    try {
        const transaction = new Transaction().add(...addOperatorInstruction);
        const txHash = await sendAndConfirmTransaction(connection, transaction, [admin], commitment);
        console.log(`Add operator success tx hash: ${txHash}`);
    } catch (error) {
        console.error('Add operator failed');
        throw error;
    }
})

program.command('remove-operator')
.description('Remove the operator')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.requiredOption('--admin <string>', 'The path to admin keypair')
.requiredOption('--operator <string>', 'The operator address')
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const admin = await getKeypairFromFile(options.admin);
    const operator = new PublicKey(options.operator);

    const removeOperatorInstruction = await createRemoveOperatorInstruction({
        connection,
        signer: admin.publicKey,
        operator,
    })

    try {
        const transaction = new Transaction().add(...removeOperatorInstruction);
        const txHash = await sendAndConfirmTransaction(connection, transaction, [admin], commitment);
        console.log(`Remove operator success tx hash: ${txHash}`);
    } catch (error) {
        console.error('Remove operator failed');
        throw error;
    }
})

program.command('set-close-duration')
.description('Set the close duration for closing finished trade and payment receipt')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.requiredOption('--operator <string>', 'The path to operator keypair')
.requiredOption('--close-trade-duration <number>', 'The duration for closing finished trade')
.requiredOption('--close-payment-duration <number>', 'The duration for closing payment receipt')
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);
    const operator = await getKeypairFromFile(options.operator);

    const closeWaitDurationInstruction = await createSetCloseWaitDurationInstruction({
        operator: operator.publicKey,    
        closeTradeDuration: options.closeTradeDuration ? options.closeTradeDuration : null,
        closePaymentDuration: options.closePaymentDuration ? options.closePaymentDuration : null,
        connection,
    })

    try {
        const transaction = new Transaction().add(...closeWaitDurationInstruction);
        const txHash = await sendAndConfirmTransaction(connection, transaction, [operator], commitment);
        console.log(`Set close wait duration success tx hash: ${txHash}`);
    } catch (error) {
        console.error('Set close wait duration failed');
        throw error;
    }
})

program.command('parse-transaction')
.description('Parse transaction, show type and input of the transaction')
.addOption(commonOptions[0])
.addOption(commonOptions[1])
.requiredOption('--txHash <string>', 'The transaction hash')
.action(async (options) => {
    const commitment = options.commitment || 'confirmed';
    const connection = new Connection(options.url, commitment);

    const parsedTransaction = await connection.getParsedTransaction(options.txHash, {
        commitment,
        maxSupportedTransactionVersion: 0,
    });

    const program = await getOptimexProgram(connection);
    const coder = new BorshCoder(program.rawIdl);

    const optimexInstructions = []
    .concat(parsedTransaction.transaction.message.instructions)
    .concat((parsedTransaction.meta?.innerInstructions ?? []).map((instruction) => instruction.instructions).flat())
    .filter((instruction) => instruction.programId?.toBase58() === program.programId.toBase58())

    const slot = parsedTransaction.slot;
    const slotTime = await connection.getBlockTime(slot);
    console.log(`Perform at slot ${parsedTransaction.slot} at time ${new Date(slotTime * 1000)}`)
    const handleDeposit = (decoded: Instruction) => {
        const depositInsData = decoded.data['deposit_args'];
        const tradeId = tradeIdBytesToString(depositInsData['trade_id']);
        const sessionId = tradeIdBytesToString(depositInsData['input']['session_id'])
        const solver = '0x' + Buffer.from(depositInsData['input']['solver']).toString('hex')
        const amountIn = BigInt(
          '0x' + Buffer.from(depositInsData['input']['trade_info']['amount_in']).toString('hex')
        ).toString()
        const fromChainUser = depositInsData['input']['trade_info']['from_chain'][0].toString()
        const fromChainNetworkId = depositInsData['input']['trade_info']['from_chain'][1].toString()
        const fromChainTokenId = depositInsData['input']['trade_info']['from_chain'][2].toString()
        const toChainUser = depositInsData['input']['trade_info']['to_chain'][0].toString()
        const toChainNetworkId = depositInsData['input']['trade_info']['to_chain'][1].toString()
        const toChainTokenId = depositInsData['input']['trade_info']['to_chain'][2].toString()
        const dataIns = {
          tradeId,
          input: {
            sessionId,
            solver,
            tradeInfo: {
              amountIn,
              fromChain: { user: fromChainUser, networkId: fromChainNetworkId, tokenId: fromChainTokenId },
              toChain: { user: toChainUser, networkId: toChainNetworkId, tokenId: toChainTokenId },
            },
          },
        }
        console.log(`DEPOSIT: `, JSON.stringify(dataIns, null, 2))
    }

    const handleClaimInstruction = (decoded: Instruction) => {
        const tradeId = tradeIdBytesToString(decoded.data['claim_args']['trade_id'])
        console.log(`CLAIM: ${tradeId}`)
    }

    const handleSettlementInstruction = (decoded: Instruction) => {
        const tradeId = tradeIdBytesToString(decoded.data['settle_args']['trade_id'])
        console.log(`SETTLEMENT: ${tradeId}`)
    }

    const handlePaymentInstruction = (decoded: Instruction) => {
        const paymentInsData = decoded.data['payment_args']
        const tradeId = tradeIdBytesToString(paymentInsData['trade_id'])
        const amount = paymentInsData['amount']
        const totalFee = paymentInsData['total_fee']
        const deadline = paymentInsData['deadline']
        const token = paymentInsData['token']
        const dataIns = {
          tradeId,
          amount: amount.toString(),
          totalFee: totalFee.toString(),
          deadline: new Date(deadline.toNumber() * 1000),
          token,
        }    

        console.log(`PAYMENT: `, JSON.stringify(dataIns, null, 2))
    }

    for (const instruction of optimexInstructions) {
        if (!('data' in instruction)) {
            continue
        }
        const decoded = coder.instruction.decode(Buffer.from(bs58.decode(instruction.data)));
        switch (decoded.name) {
            case 'deposit':
                handleDeposit(decoded);
                break;
            case 'claim':
                handleClaimInstruction(decoded);
                break;
            case 'settlement':
                handleSettlementInstruction(decoded);
                break;
            case 'payment':
                handlePaymentInstruction(decoded);
                break;
            default:
                console.log(`Unknown instruction ${decoded.name}`)
        }
    }
})


program.parse()

function formatTradeDetail(tradeDetail: ProgramAccount<TradeDetail>) {
    return {
        pubkey: tradeDetail.publicKey.toBase58(),
        account: {
            ...tradeDetail.account,
            tradeId: tradeIdBytesToString(tradeDetail.account.tradeId),
            userPubkey: tradeDetail.account.userPubkey.toBase58(),
            token: tradeDetail.account.token ? tradeDetail.account.token.toBase58() : 'native',
            amount: tradeDetail.account.amount.toString(),
            mpcPubkey: tradeDetail.account.mpcPubkey.toBase58(),
            userEphemeralPubkey: tradeDetail.account.userEphemeralPubkey.toBase58(),
            refundPubkey: tradeDetail.account.refundPubkey.toBase58(),
            totalFee: tradeDetail.account.totalFee?.toString(),
            status: tradeDetail.account.status.deposited ? 'deposited' : tradeDetail.account.status.settled ? 'settled' : 'claimed',
            settledPmm: tradeDetail.account.settledPmm.toBase58(),
            timeout: convertUnitTimestampToDateTime(tradeDetail.account.timeout.toNumber()),
        }
    }
}

function formatPayment(payment: ProgramAccount<PaymentReceipt>) {
    return {
        pubkey: payment.publicKey.toBase58(),
        account: {
            ...payment.account,
            tradeId: tradeIdBytesToString(payment.account.tradeId),
            fromPubkey: payment.account.fromPubkey.toBase58(),
            toPubkey: payment.account.toPubkey.toBase58(),
            token: payment.account.token ? payment.account.token.toBase58() : 'native',
            paymentAmount: payment.account.paymentAmount.toString(),
            totalFee: payment.account.totalFee.toString(),
            paymentTime: convertUnitTimestampToDateTime(payment.account.paymentTime.toNumber()),
        }
    }
}

function convertUnitTimestampToDateTime(timestamp: number) {
    return new Date(timestamp * 1000).toISOString();
}