export class InvalidPresignStringError extends Error {
  constructor(message: string, metadata: Record<string, string | number | null>) {
    super(`${message} with information: ${JSON.stringify(metadata)}`)
    this.name = 'InvalidPresignStringError'
  }
}
