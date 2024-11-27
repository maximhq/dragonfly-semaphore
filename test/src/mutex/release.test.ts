import { expect } from 'chai'

import { releaseMutex as release } from '../../../src/mutex/release'
import { client1 as client, clusterClient } from '../../redisClient'

describe('Mutex release', () => {
  it('should remove key after release', async () => {
    await client.set('key', '111')
    await release(client, 'key', '111')
    expect(await client.get('key')).to.be.eql(null)
  })
  it('should do nothing if resource is not locked', async () => {
    expect(await client.get('key')).to.be.eql(null)
    await release(client, 'key', '111')
    expect(await client.get('key')).to.be.eql(null)
  })
})

describe('mutex release with cluster', function () {
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

  // Basic release functionality
  it('should release lock across cluster nodes', async function () {
    await clusterClient.set('cluster-key', '111')
    await release(clusterClient, 'cluster-key', '111')
    const value = await clusterClient.get('cluster-key')
    expect(value).to.be.null
  })

  it('should not release if identifier does not match', async function () {
    await clusterClient.set('key', '111')
    await release(clusterClient, 'key', '222')
    const value = await clusterClient.get('key')
    expect(value).to.equal('111')
  })

  // Cluster-specific tests
  it('should handle concurrent release operations', async function () {
    await clusterClient.set('concurrent-key', '111')

    // Perform concurrent releases
    await Promise.all([
      release(clusterClient, 'concurrent-key', '111'),
      release(clusterClient, 'concurrent-key', '111'),
      release(clusterClient, 'concurrent-key', '111')
    ])

    // Verify the key was released
    const value = await clusterClient.get('concurrent-key')
    expect(value).to.be.null
  })

  it('should release locks across different slots', async function () {
    const keys = [
      'key1',
      'different-key',
      'another-key',
      'test-key',
      'sample-key'
    ]

    // Set all keys
    await Promise.all(keys.map(key => clusterClient.set(key, '111')))

    // Release all keys
    await Promise.all(keys.map(key => release(clusterClient, key, '111')))

    // Verify all keys are released
    const values = await Promise.all(keys.map(key => clusterClient.get(key)))
    expect(values.every(v => v === null)).to.be.true
  })

  it('should release locks across different slots', async function () {
    const keys = [
      'key1',
      'different-key',
      'another-key',
      'test-key',
      'sample-key'
    ]

    // Set all keys
    await Promise.all(keys.map(key => clusterClient.set(key, '111')))

    // Release all keys
    await Promise.all(keys.map(key => release(clusterClient, key, '111')))

    // Verify all keys are released
    const values = await Promise.all(keys.map(key => clusterClient.get(key)))
    expect(values.every(v => v === null)).to.be.true
  })

  it('should handle release of non-existent keys', async function () {
    // Release non-existent keys
    await Promise.all([
      release(clusterClient, 'non-existent-1', '111'),
      release(clusterClient, 'non-existent-2', '111'),
      release(clusterClient, 'non-existent-3', '111')
    ])

    // Verify keys don't exist
    const values = await Promise.all([
      clusterClient.get('non-existent-1'),
      clusterClient.get('non-existent-2'),
      clusterClient.get('non-existent-3')
    ])
    expect(values.every(v => v === null)).to.be.true
  })

  it('should handle mixed release operations', async function () {
    // Set some keys but not others
    await Promise.all([
      clusterClient.set('existing-1', '111'),
      clusterClient.set('existing-2', '111')
    ])

    const results = await Promise.all([
      release(clusterClient, 'existing-1', '111'), // should succeed
      release(clusterClient, 'non-existing', '111'), // should fail
      release(clusterClient, 'existing-2', '222'), // should fail (wrong id)
      release(clusterClient, 'existing-2', '111') // should succeed
    ])

    expect(results[0]).to.be.true // existing-1 release
    expect(results[1]).to.be.false // non-existing release
    expect(results[2]).to.be.false // wrong identifier
    expect(results[3]).to.be.true // existing-2 release
  })

  it('should handle rapid acquire-release cycles', async function () {
    const key = 'cycle-key'
    const cycles = 5

    for (let i = 0; i < cycles; i++) {
      // Acquire
      await clusterClient.set(key, `111-${i}`)
      const valueAfterAcquire = await clusterClient.get(key)
      expect(valueAfterAcquire).to.equal(`111-${i}`)

      // Release
      const released = await release(clusterClient, key, `111-${i}`)
      expect(released).to.be.true

      const valueAfterRelease = await clusterClient.get(key)
      expect(valueAfterRelease).to.be.null
    }
  })

  it('should handle release after expiry', async function () {
    const key = 'expiry-key'

    // Set key with short TTL
    await clusterClient.set(key, '111', 'PX', 100)

    // Wait for expiry
    await new Promise(resolve => setTimeout(resolve, 150))

    // Try to release
    const result = await release(clusterClient, key, '111')
    expect(result).to.be.false
  })
})
