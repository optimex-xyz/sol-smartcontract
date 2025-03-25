import { clusterApiUrl, Connection } from "@solana/web3.js";
import { getConfigData } from "../../solana-js";

(async () => {
    const connection = new Connection(clusterApiUrl('devnet'));
    const configData = await getConfigData(connection)
    console.log(configData)
    console.log(configData.operators.length)
})();
