export class FetchAccountError extends Error {
  constructor(address: string, metadata: Record<string, string>) {
    super(`Cannot fetch account: ${address} with information ${JSON.stringify(metadata)}`)
    this.name = 'FetchAccountError'
  }
}
