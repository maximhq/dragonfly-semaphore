import { expect } from 'chai'

import { acquireMutex as acquire, Options } from '../../../src/mutex/acquire'
import { client1 as client, clusterClient } from '../../redisClient'

const opts = (id: string, overrides?: Partial<Options>): Options => ({
  identifier: id,
  acquireTimeout: 50,
  acquireAttemptsLimit: Number.POSITIVE_INFINITY,
  lockTimeout: 100,
  retryInterval: 10,
  ...overrides
})

describe('mutex acquire', () => {
  it('should return true for success lock', async () => {
    const result = await acquire(client, 'key', opts('111'))
    expect(result).to.be.true
  })
  it('should return false when timeout', async () => {
    const result1 = await acquire(client, 'key', opts('111'))
    const result2 = await acquire(client, 'key', opts('222'))
    expect(result1).to.be.true
    expect(result2).to.be.false
  })
  it('should return false after acquireAttemptsLimit', async () => {
    const result1 = await acquire(client, 'key', opts('111'))
    const result2 = await acquire(
      client,
      'key',
      opts('222', {
        acquireAttemptsLimit: 1,
        acquireTimeout: Number.POSITIVE_INFINITY
      })
    )
    expect(result1).to.be.true
    expect(result2).to.be.false
  })
  it('should set identifier for key', async () => {
    await acquire(client, 'key1', opts('111'))
    const value = await client.get('key1')
    expect(value).to.be.eql('111')
  })
  it('should set TTL for key', async () => {
    await acquire(client, 'key2', opts('111'))
    const ttl = await client.pttl('key2')
    expect(ttl).to.be.gte(90)
    expect(ttl).to.be.lte(100)
  })
  it('should wait for auto-release', async () => {
    const start1 = Date.now()
    await acquire(client, 'key', opts('111'))
    const start2 = Date.now()
    await acquire(client, 'key', opts('222'))
    const now = Date.now()
    expect(start2 - start1).to.be.gte(0)
    expect(start2 - start1).to.be.lt(10)
    expect(now - start1).to.be.gte(50)
    expect(now - start2).to.be.gte(50)
  })
  it('should wait per key', async () => {
    const start1 = Date.now()
    await Promise.all([
      acquire(client, 'key1', opts('a1')),
      acquire(client, 'key2', opts('a2'))
    ])
    const start2 = Date.now()
    await Promise.all([
      acquire(client, 'key1', opts('b1')),
      acquire(client, 'key2', opts('b2'))
    ])
    const now = Date.now()
    expect(start2 - start1).to.be.gte(0)
    expect(start2 - start1).to.be.lt(10)
    expect(now - start1).to.be.gte(50)
    expect(now - start2).to.be.gte(50)
  })
})

describe('mutex acquire with cluster', function () {
  this.timeout(30000)

  before(async function () {
    if (clusterClient.status === 'wait' || clusterClient.status === 'close') {
      await clusterClient.connect()
    }
  })

  beforeEach(async function () {
    await clusterClient.flushall()
  })

  after(async function () {
    console.log('Cleaning up cluster connection...')
    try {
      await clusterClient.quit()
      await new Promise(resolve => setTimeout(resolve, 100))
      await clusterClient.disconnect(false)
      console.log('Cluster connection closed')
    } catch (error) {
      console.error('Error during cluster cleanup:', error)
    }
  })

  // Basic cluster functionality tests
  it('should acquire lock across cluster nodes', async function () {
    const result = await acquire(clusterClient, 'cluster-key', opts('111'))
    expect(result).to.be.true
    const value = await clusterClient.get('cluster-key')
    expect(value).to.equal('111')
  })

  it('should handle concurrent lock attempts across cluster', async function () {
    const results = await Promise.all([
      acquire(clusterClient, 'concurrent-key', opts('111')),
      acquire(clusterClient, 'concurrent-key', opts('222')),
      acquire(clusterClient, 'concurrent-key', opts('333'))
    ])

    // Only one should succeed
    expect(results.filter(r => r === true).length).to.equal(1)
    expect(results.filter(r => r === false).length).to.equal(2)
  })

  it('should distribute locks across different slots', async function () {
    const keys = [
      'key1',
      'different-key',
      'another-key',
      'test-key',
      'sample-key'
    ]
    const results = await Promise.all(
      keys.map(key => acquire(clusterClient, key, opts('111')))
    )

    // All should succeed as they're different keys
    expect(results.every(r => r === true)).to.be.true

    // Verify all keys are set
    const values = await Promise.all(keys.map(key => clusterClient.get(key)))
    expect(values.every(v => v === '111')).to.be.true
  })

  it('should respect TTL across cluster nodes', async function () {
    const key = 'ttl-test-key'
    await acquire(clusterClient, key, opts('111', { lockTimeout: 100 }))

    const ttl = await clusterClient.pttl(key)
    expect(ttl).to.be.gte(90)
    expect(ttl).to.be.lte(100)
  })

  it('should handle acquire timeout across cluster', async function () {
    // First acquire should succeed
    const result1 = await acquire(clusterClient, 'timeout-key', opts('111'))
    expect(result1).to.be.true

    // Second acquire should timeout
    const result2 = await acquire(
      clusterClient,
      'timeout-key',
      opts('222', { acquireTimeout: 100 })
    )
    expect(result2).to.be.false
  })

  it('should handle multiple attempts with retry', async function () {
    const key = 'retry-key'

    // First acquire with a longer timeout
    const result1 = await acquire(
      clusterClient,
      key,
      opts('111', {
        lockTimeout: 1000 // Ensure lock stays held during retries
      })
    )
    expect(result1).to.be.true

    // Verify the lock is held
    const value = await clusterClient.get(key)
    expect(value).to.equal('111')

    // Second acquire should retry and fail
    const start = Date.now()
    const result2 = await acquire(
      clusterClient,
      key,
      opts('222', {
        acquireTimeout: 200, // Total time to try acquiring
        retryInterval: 50, // Time between retries
        acquireAttemptsLimit: 3, // Maximum number of attempts
        lockTimeout: 1000 // Lock timeout if acquired
      })
    )
    const duration = Date.now() - start

    // Verify the behavior
    expect(result2).to.be.false
    expect(duration).to.be.gte(100) // Should have tried at least twice
    expect(duration).to.be.lte(250) // Shouldn't exceed acquireTimeout

    // Verify the original lock is still held
    const finalValue = await clusterClient.get(key)
    expect(finalValue).to.equal('111')
  })

  // Let's also add a more detailed retry test
  it('should respect acquireAttemptsLimit', async function () {
    const key = 'retry-limit-key'

    // First acquire the lock
    const result1 = await acquire(clusterClient, key, opts('111'))
    expect(result1).to.be.true

    // Try to acquire with limited attempts
    const start = Date.now()
    const result2 = await acquire(
      clusterClient,
      key,
      opts('222', {
        acquireAttemptsLimit: 2,
        retryInterval: 50,
        acquireTimeout: 1000 // Long timeout to ensure attempts limit is hit first
      })
    )
    const duration = Date.now() - start

    expect(result2).to.be.false
    expect(duration).to.be.gte(50) // At least one retry
    expect(duration).to.be.lte(150) // But not too many retries
  })

  it('should handle auto-release across cluster nodes', async function () {
    const key = 'auto-release-key'

    // Acquire with short timeout
    await acquire(clusterClient, key, opts('111', { lockTimeout: 100 }))

    // Wait for auto-release
    await new Promise(resolve => setTimeout(resolve, 150))

    // Should be able to acquire again
    const result = await acquire(clusterClient, key, opts('222'))
    expect(result).to.be.true

    const value = await clusterClient.get(key)
    expect(value).to.equal('222')
  })

  it('should handle multiple keys with different timeouts', async function () {
    const results = await Promise.all([
      acquire(clusterClient, 'key1', opts('111', { lockTimeout: 100 })),
      acquire(clusterClient, 'key2', opts('111', { lockTimeout: 200 })),
      acquire(clusterClient, 'key3', opts('111', { lockTimeout: 300 }))
    ])

    expect(results.every(r => r === true)).to.be.true

    const ttls = await Promise.all([
      clusterClient.pttl('key1'),
      clusterClient.pttl('key2'),
      clusterClient.pttl('key3')
    ])

    expect(ttls[0]).to.be.lte(100)
    expect(ttls[1]).to.be.lte(200)
    expect(ttls[2]).to.be.lte(300)
  })
})
