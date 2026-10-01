import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { ConfigError, parseConfig } from './config.js'

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  ISSUER_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
}

const testConfig = parseConfig(validEnv)

describe('configuration', () => {
  it('accepts a valid environment', () => {
    expect(testConfig.NODE_ENV).toBe('test')
    expect(testConfig.PORT).toBe(3000)
  })

  it('rejects a missing required value rather than defaulting', () => {
    // 17 §3: the process must refuse to start, not boot and fail later in front
    // of a user.
    expect(() => parseConfig({ NODE_ENV: 'test' })).toThrow(ConfigError)
  })

  it('rejects an invalid enum value', () => {
    expect(() => parseConfig({ ...validEnv, NODE_ENV: 'staging' })).toThrow(ConfigError)
  })

  it('rejects a non-URL issuer', () => {
    expect(() => parseConfig({ ...validEnv, ISSUER_URL: 'not-a-url' })).toThrow(ConfigError)
  })

  it('rejects an out-of-range port', () => {
    expect(() => parseConfig({ ...validEnv, PORT: '99999' })).toThrow(ConfigError)
  })

  it('names every failing key, so the error is actionable', () => {
    try {
      parseConfig({})
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const issues = (error as ConfigError).issues.join('\n')
      expect(issues).toContain('NODE_ENV')
      expect(issues).toContain('ISSUER_URL')
    }
  })
})

describe('health endpoints', () => {
  it('/healthz has no dependencies and reports ok', async () => {
    const app = await buildApp(testConfig)
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok' })
    await app.close()
  })

  it('/readyz reports its checks', async () => {
    const app = await buildApp(testConfig)
    const res = await app.inject({ method: 'GET', url: '/readyz' })
    expect(res.statusCode).toBe(200)
    expect(res.json().checks).toHaveProperty('database')
    await app.close()
  })

  it('neither endpoint leaks internals', async () => {
    const app = await buildApp(testConfig)
    for (const url of ['/healthz', '/readyz']) {
      const body = JSON.stringify((await app.inject({ method: 'GET', url })).json())
      expect(body).not.toContain('localhost:3000') // no issuer / internal hosts
      expect(body).not.toMatch(/postgres|password|secret/i)
    }
    await app.close()
  })
})

describe('correlation id (13 §8, 16 §7)', () => {
  it('returns a generated id when none is supplied', async () => {
    const app = await buildApp(testConfig)
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    await app.close()
  })

  it('echoes a valid client-supplied id', async () => {
    const app = await buildApp(testConfig)
    const id = '018f3e9a-1b2c-7d3e-8f4a-5b6c7d8e9f01'
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': id },
    })
    expect(res.headers['x-request-id']).toBe(id)
    await app.close()
  })

  it('ignores a malformed client id rather than trusting it', async () => {
    // An unvalidated client value would let a caller poison log aggregation.
    const app = await buildApp(testConfig)
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'not-a-uuid; DROP TABLE' },
    })
    expect(res.headers['x-request-id']).not.toBe('not-a-uuid; DROP TABLE')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    await app.close()
  })
})

describe('error contract (13 §5)', () => {
  it('returns the standard shape with a requestId on 404', async () => {
    const app = await buildApp(testConfig)
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' })
    expect(res.statusCode).toBe(404)
    const body = res.json()
    expect(body.error.code).toBe('not_found')
    expect(body.error.requestId).toBe(res.headers['x-request-id'])
    await app.close()
  })
})

describe('security headers (15 §7)', () => {
  it('sets the hardening headers on every response', async () => {
    const app = await buildApp(testConfig)
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    await app.close()
  })
})
