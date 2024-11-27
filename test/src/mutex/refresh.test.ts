import { expect } from 'chai'

import { refreshMutex as refresh } from '../../../src/mutex/refresh'
import { client1 as client, clusterClient } from '../../redisClient'

describe('mutex refresh', () => {
  it('should return false if resource is already acquired by different instance', async () => {
    await client.set('key', '222')
    const result = await refresh(client, 'key', '111', 10000)
    expect(result).to.be.false
  })
  it('should return false if resource is not acquired', async () => {
    const result = await refresh(client, 'key', '111', 10000)
    expect(result).to.be.false
  })
  it('should return true for success refresh', async () => {
    await client.set('key', '111')
    const result = await refresh(client, 'key', '111', 20000)
    expect(result).to.be.true
    expect(await client.pttl('key')).to.be.gte(10000)
  })
})

describe('mutex refresh with cluster', function () {
  this.timeout(30000)

  before(async function () {
    if (clusterClient.status === 'wait' || clusterClient.status === 'close') {
      await clusterClient.connect()
    }
  })

  after(async function () {
    console.log('Cleaning up cluster connection...')
    try {
      await clusterClient.quit()
      await new Promise(resolve => setTimeout(resolve, 100))
      await clusterClient.disconnect(false)
      console.log('Cluster connection closed')
      setTimeout(() => {
        console.log('Forcing process exit')
        process.exit(0)
      }, 500)
    } catch (error) {
      console.error('Error during cluster cleanup:', error)
      process.exit(1)
    }
  })

  beforeEach(async function () {
    await clusterClient.flushall()
  })

  // Basic functionality tests
  it('should return false if resource is already acquired by different instance', async function () {
    await clusterClient.set('key', '222')
    const result = await refresh(clusterClient, 'key', '111', 10000)
    expect(result).to.be.false
  })

  it('should return false if resource is not acquired', async function () {
    const result = await refresh(clusterClient, 'key', '111', 10000)
    expect(result).to.be.false
  })

  it('should return true for success refresh', async function () {
    await clusterClient.set('key', '111')
    const result = await refresh(clusterClient, 'key', '111', 20000)
    expect(result).to.be.true
    expect(await clusterClient.pttl('key')).to.be.gte(10000)
  })

  // Cluster-specific tests
  it('should handle multiple keys across different slots', async function () {
    const keys = ['key1', 'key2', 'key3', 'different-key', 'another-key']

    // Set all keys
    await Promise.all(
      keys.map(key => clusterClient.set(key, '111', 'PX', 5000))
    )

    // Refresh all keys
    const results = await Promise.all(
      keys.map(key => refresh(clusterClient, key, '111', 10000))
    )

    // All refreshes should succeed
    expect(results.every(result => result === true)).to.be.true

    // Check TTLs
    const ttls = await Promise.all(keys.map(key => clusterClient.pttl(key)))
    expect(ttls.every(ttl => ttl >= 9000)).to.be.true
  })

  it('should handle concurrent refresh requests', async function () {
    await clusterClient.set('concurrent-key', '111', 'PX', 5000)

    // Perform multiple concurrent refreshes
    const results = await Promise.all([
      refresh(clusterClient, 'concurrent-key', '111', 10000),
      refresh(clusterClient, 'concurrent-key', '111', 15000),
      refresh(clusterClient, 'concurrent-key', '111', 20000)
    ])

    expect(results.every(result => result === true)).to.be.true
    const ttl = await clusterClient.pttl('concurrent-key')
    expect(ttl).to.be.gte(10000)
  })

  it('should handle refresh with different TTLs', async function () {
    await clusterClient.set('ttl-key', '111', 'PX', 5000)

    // Refresh with increasing TTLs
    const result1 = await refresh(clusterClient, 'ttl-key', '111', 10000)
    expect(result1).to.be.true
    let ttl = await clusterClient.pttl('ttl-key')
    expect(ttl).to.be.gte(9000)

    // Refresh with higher TTL
    const result2 = await refresh(clusterClient, 'ttl-key', '111', 20000)
    expect(result2).to.be.true
    ttl = await clusterClient.pttl('ttl-key')
    expect(ttl).to.be.gte(19000)
  })

  it('should handle non-existent keys correctly', async function () {
    const results = await Promise.all([
      refresh(clusterClient, 'non-existent-1', '111', 10000),
      refresh(clusterClient, 'non-existent-2', '111', 10000),
      refresh(clusterClient, 'non-existent-3', '111', 10000)
    ])

    expect(results.every(result => result === false)).to.be.true
  })

  it('should handle refresh with wrong instance ID', async function () {
    // Set keys with one instance ID
    await Promise.all([
      clusterClient.set('wrong-id-1', '111'),
      clusterClient.set('wrong-id-2', '111'),
      clusterClient.set('wrong-id-3', '111')
    ])

    // Try to refresh with different instance ID
    const results = await Promise.all([
      refresh(clusterClient, 'wrong-id-1', '222', 10000),
      refresh(clusterClient, 'wrong-id-2', '222', 10000),
      refresh(clusterClient, 'wrong-id-3', '222', 10000)
    ])

    expect(results.every(result => result === false)).to.be.true
  })
})
