import { SubstackConfigurationError } from './errors.js'

export function positiveInteger(value: number | string, name: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new SubstackConfigurationError(`${name} must be a positive integer.`)
  }
  return parsed
}

export function nonNegativeInteger(value: number | string, name: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SubstackConfigurationError(`${name} must be a non-negative integer.`)
  }
  return parsed
}

export function boundedString(value: string, name: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw new SubstackConfigurationError(
      `${name} must contain between ${minimum.toLocaleString('en-US')} and ${maximum.toLocaleString('en-US')} characters.`
    )
  }
  return value
}
