import { expect } from 'chai'
import { after, before, describe, it } from 'mocha'
import sinon from 'sinon'
import LostLockError from '../../src/errors/LostLockError'
import Semaphore from '../../src/RedisSemaphore'
import { TimeoutOptions } from '../../src/types'
import { delay } from '../../src/utils/index'
import { clusterClient } from '../redisClient'
import {
  catchUnhandledRejection,
  throwUnhandledRejection
} from '../unhandledRejection'

const timeoutOptions: TimeoutOptions = {
  lockTimeout: 300,
  acquireTimeout: 100,
  refreshInterval: 80,
  retryInterval: 10
}

describe('Semaphore Cluster', () => {
  let client: typeof clusterClient

  before(async () => {
    client = clusterClient
  })

  after(async () => {
    await client.quit()
    // Add a small delay to ensure connection is closed
    await new Promise(resolve => setTimeout(resolve, 100))
  })

  it('should acquire and release semaphore', async () => {
    const keys = ['key1', 'key2', 'key3']
    const semaphoresWithKeys = keys.map(key => ({
      semaphore: new Semaphore(client, key, 2, timeoutOptions),
      key
    }))

    // Acquire all locks
    await Promise.all(
      semaphoresWithKeys.map(({ semaphore }) => semaphore.acquire())
    )

    // Verify all locks are acquired
    for (const { semaphore, key } of semaphoresWithKeys) {
      expect(semaphore.isAcquired).to.be.true
      expect(await client.zrange(`semaphore:${key}`, 0, -1)).to.have.members([
        semaphore.identifier
      ])
    }

    // Release all locks
    await Promise.all(
      semaphoresWithKeys.map(({ semaphore }) => semaphore.release())
    )

    // Verify all locks are released
    for (const { semaphore, key } of semaphoresWithKeys) {
      expect(semaphore.isAcquired).to.be.false
      expect(await client.zcard(`semaphore:${key}`)).to.be.eql(0)
    }
  })

  it('should handle multiple semaphores on same key', async () => {
    const key = 'multipleTest'
    const semaphore1 = new Semaphore(client, key, 2, timeoutOptions)
    const semaphore2 = new Semaphore(client, key, 2, timeoutOptions)
    const semaphore3 = new Semaphore(client, key, 2, timeoutOptions)

    await semaphore1.acquire()
    await semaphore2.acquire()

    // Third semaphore should timeout as limit is 2
    await expect(semaphore3.acquire()).to.be.rejectedWith(
      'Acquire semaphore semaphore:multipleTest timeout'
    )

    expect(await client.zcard(`semaphore:${key}`)).to.be.eql(2)

    await semaphore1.release()
    await semaphore2.release()

    expect(await client.zcard(`semaphore:${key}`)).to.be.eql(0)
  })

  describe('lost lock case', () => {
    beforeEach(() => {
      catchUnhandledRejection()
    })

    afterEach(() => {
      throwUnhandledRejection()
    })

    it('should handle lost lock with callback', async () => {
      const onLockLostCallback = sinon.spy(function (this: Semaphore) {
        expect(this.isAcquired).to.be.false
      })

      const semaphore = new Semaphore(client, 'lostLockTest', 2, {
        ...timeoutOptions,
        onLockLost: onLockLostCallback
      })

      await semaphore.acquire()
      await client.del('semaphore:lostLockTest')

      await delay(200)

      expect(semaphore.isAcquired).to.be.false
      expect(onLockLostCallback).to.be.called
      expect(onLockLostCallback.firstCall.firstArg instanceof LostLockError).to
        .be.true
    })
  })

  // Clean up any remaining keys after all tests
  afterEach(async () => {
    const keys = ['key1', 'key2', 'key3', 'multipleTest', 'lostLockTest']
    for (const key of keys) {
      await client.del(`semaphore:${key}`)
    }
  })
})
