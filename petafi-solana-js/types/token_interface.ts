export interface IToken {
    id?: number;
    networkId: string;
    tokenId: string;
    networkName?: string;
    networkSymbol?: string;
    networkType?: string;
    tokenName?: string;
    tokenSymbol?: string;
    tokenAddress: string;
    tokenDecimals: number;
    tokenLogoUri?: string;
    networkLogoUri?: string;
    active?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export type SimpleToken = Pick<IToken, 'tokenId' | 'tokenAddress' | 'networkId' | 'networkType'>