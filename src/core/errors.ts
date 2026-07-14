export class SubstackConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubstackConfigurationError'
  }
}

export class SubstackApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly detail?: string
  ) {
    super(message)
    this.name = 'SubstackApiError'
  }
}
