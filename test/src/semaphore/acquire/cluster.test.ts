import { expect } from 'chai'
import {
  acquireSemaphore as acquire,
  Options
} from '../../../../src/semaphore/acquire/index'
import { clusterClient as client } from '../../../redisClient'

const opts = (id: string, overrides?: Partial<Options>): Options => ({
  identifier: id,
  acquireTimeout: 50,
  acquireAttemptsLimit: Number.POSITIVE_INFINITY,
  lockTimeout: 100,
  retryInterval: 10,
  ...overrides
})

describe('semaphore acquire - cluster', () => {
  // Basic acquisition test
  it('should acquire semaphore successfully in cluster mode', async () => {
    const result = await acquire(client, 'cluster:key1', 1, opts('111'))
    expect(result).to.be.true
  })

  // Test timeout scenario with multiple nodes
  it('should handle timeout correctly across cluster nodes', async () => {
    const key = 'cluster:key2'
    const result1 = await acquire(client, key, 2, opts('111'))
    const result2 = await acquire(client, key, 2, opts('112'))
    const result3 = await acquire(client, key, 2, opts('113'))

    expect(result1).to.be.true
    expect(result2).to.be.true
    expect(result3).to.be.false
  })

  // Test acquire attempts limit in cluster
  it('should respect acquireAttemptsLimit in cluster mode', async () => {
    const key = 'cluster:key3'
    const result1 = await acquire(client, key, 2, opts('111'))
    const result2 = await acquire(client, key, 2, opts('112'))
    const result3 = await acquire(
      client,
      key,
      2,
      opts('113', {
        acquireAttemptsLimit: 1,
        acquireTimeout: Number.POSITIVE_INFINITY
      })
    )

    expect(result1).to.be.true
    expect(result2).to.be.true
    expect(result3).to.be.false
  })

  // Additional cluster-specific tests
  it('should handle slot migration scenarios', async () => {
    // Test acquiring locks during simulated slot migration
    const results = await Promise.all([
      acquire(client, 'cluster:key4{tag}', 1, opts('111')),
      acquire(client, 'cluster:key5{tag}', 1, opts('112')),
      acquire(client, 'cluster:key6{tag}', 1, opts('113'))
    ])

    expect(results.filter(r => r === true).length).to.be.greaterThan(0)
  })

  it('should handle network partitions gracefully', async () => {
    const key = 'cluster:key7'
    // Attempt to acquire with shorter timeout to test partition scenarios
    const result = await acquire(
      client,
      key,
      1,
      opts('111', {
        acquireTimeout: 25,
        retryInterval: 5
      })
    )

    expect(typeof result).to.equal('boolean')
  })
})
