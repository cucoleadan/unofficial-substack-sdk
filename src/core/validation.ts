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
