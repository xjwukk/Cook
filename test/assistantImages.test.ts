import { describe, expect, it } from 'vitest'
import {
  checkImageBudget,
  dataUrlBytes,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_COUNT,
  MAX_TOTAL_IMAGE_BYTES,
  splitDataUrl,
  stripDataUrlPrefix,
} from '../apps/web/app/utils/assistantImages'

describe('dataUrlBytes', () => {
  it('counts the decoded size of a base64 payload', () => {
    // "abc" 是 3 个字节。
    expect(dataUrlBytes('data:image/jpeg;base64,YWJj')).toBe(3)
    expect(dataUrlBytes('YWJj')).toBe(3)
    expect(dataUrlBytes('')).toBe(0)
  })

  it('accounts for base64 padding', () => {
    expect(dataUrlBytes('YQ==')).toBe(1)
    expect(dataUrlBytes('YWI=')).toBe(2)
  })
})

describe('splitDataUrl', () => {
  it('splits a valid data URL', () => {
    expect(splitDataUrl('data:image/PNG;base64,YWJj')).toEqual({ mime: 'image/png', base64: 'YWJj' })
  })

  it('rejects anything that is not a base64 data URL', () => {
    expect(splitDataUrl('data:image/png,abc')).toBeNull()
    expect(splitDataUrl('https://example.com/a.png')).toBeNull()
    expect(splitDataUrl('')).toBeNull()
  })
})

describe('stripDataUrlPrefix', () => {
  it('keeps plain base64 and strips the data URL prefix', () => {
    expect(stripDataUrlPrefix('YWJj')).toBe('YWJj')
    expect(stripDataUrlPrefix('data:image/jpeg;base64,YWJj')).toBe('YWJj')
  })
})

describe('checkImageBudget', () => {
  it('allows a request inside every limit', () => {
    expect(checkImageBudget(0, 0, [{ bytes: 100_000 }])).toBeNull()
  })

  it('rejects too many images', () => {
    const error = checkImageBudget(0, 0, Array.from({ length: MAX_IMAGE_COUNT + 1 }, () => ({ bytes: 10 })))
    expect(error).toContain(String(MAX_IMAGE_COUNT))
  })

  it('rejects a single oversized image', () => {
    const error = checkImageBudget(0, 0, [{ bytes: MAX_IMAGE_BYTES + 1 }])
    expect(error).toContain('KB')
  })

  it('rejects an oversized total', () => {
    // 已经附了两张，再加两张就超过总量上限（单张仍在限额内）。
    const error = checkImageBudget(MAX_TOTAL_IMAGE_BYTES - MAX_IMAGE_BYTES, 2, [{ bytes: MAX_IMAGE_BYTES }, { bytes: MAX_IMAGE_BYTES }])
    expect(error).toContain('MB')
  })
})
