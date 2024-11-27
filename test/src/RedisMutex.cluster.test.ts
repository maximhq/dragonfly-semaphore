import { expect } from 'chai'
import LostLockError from '../../src/errors/LostLockError'
import Mutex from '../../src/RedisMutex'
import { TimeoutOptions } from '../../src/types'
import { delay } from '../../src/utils/index'
import { clusterClient } from '../redisClient'
import {
  catchUnhandledRejection,
  throwUnhandledRejection
} from '../unhandledRejection'
import sinon from 'sinon'

const timeoutOptions: TimeoutOptions = {
  lockTimeout: 300,
  acquireTimeout: 100,
  refreshInterval: 80,
  retryInterval: 10
}

describe('Mutex with Redis Cluster', () => {
  before(async function () {
    if (clusterClient.status === 'wait' || clusterClient.status === 'close') {
      await clusterClient.connect()
    }
  })

  beforeEach(async () => {
    await clusterClient.flushall()
  })

  after(async function () {
    try {
      await clusterClient.quit()
      await new Promise(resolve => setTimeout(resolve, 100))
      await clusterClient.disconnect(false)
    } catch (error) {
      console.error('Error during cleanup:', error)
    }
  })

  it('should acquire and release lock across cluster nodes', async () => {
    const mutex = new Mutex(clusterClient, 'cluster-key')
    expect(mutex.isAcquired).to.be.false
    await mutex.acquire()
    expect(mutex.isAcquired).to.be.true
    expect(await clusterClient.get('mutex:cluster-key')).to.be.eql(
      mutex.identifier
    )
    await mutex.release()
    expect(mutex.isAcquired).to.be.false
    expect(await clusterClient.get('mutex:cluster-key')).to.be.eql(null)
  })

  it('should handle concurrent mutex operations', async () => {
    const mutexes = Array.from(
      { length: 5 },
      () => new Mutex(clusterClient, 'concurrent-key', timeoutOptions)
    )

    const results = await Promise.all(mutexes.map(mutex => mutex.tryAcquire()))

    // Only one should succeed
    expect(results.filter(r => r === true).length).to.equal(1)
    expect(results.filter(r => r === false).length).to.equal(4)

    // Release all (only the successful one will actually release)
    await Promise.all(mutexes.map(mutex => mutex.release()))
    expect(await clusterClient.get('mutex:concurrent-key')).to.be.eql(null)
  })

  it('should distribute locks across different slots', async () => {
    const keys = [
      'key1',
      'different-key',
      'another-key',
      'test-key',
      'sample-key'
    ]
    const mutexesWithKeys = keys.map(key => ({
      mutex: new Mutex(clusterClient, key, timeoutOptions),
      key
    }))

    // Acquire all locks
    await Promise.all(mutexesWithKeys.map(({ mutex }) => mutex.acquire()))

    // Verify all locks are acquired
    for (const { mutex, key } of mutexesWithKeys) {
      expect(mutex.isAcquired).to.be.true
      expect(await clusterClient.get(`mutex:${key}`)).to.be.eql(
        mutex.identifier
      )
    }

    // Release all locks
    await Promise.all(mutexesWithKeys.map(({ mutex }) => mutex.release()))

    // Verify all locks are released
    for (const { mutex, key } of mutexesWithKeys) {
      expect(mutex.isAcquired).to.be.false
      expect(await clusterClient.get(`mutex:${key}`)).to.be.eql(null)
    }
  })

  it('should refresh lock across cluster nodes', async () => {
    const mutex = new Mutex(clusterClient, 'refresh-key', timeoutOptions)
    await mutex.acquire()
    await delay(400)
    expect(await clusterClient.get('mutex:refresh-key')).to.be.eql(
      mutex.identifier
    )
    await mutex.release()
    expect(await clusterClient.get('mutex:refresh-key')).to.be.eql(null)
  })

  describe('lost lock case in cluster', () => {
    beforeEach(() => {
      catchUnhandledRejection()
    })

    afterEach(() => {
      throwUnhandledRejection()
    })

    it('should handle lost lock in cluster mode', async () => {
      const onLockLostCallback = sinon.spy(function (this: Mutex) {
        expect(this.isAcquired).to.be.false
      })

      const mutex = new Mutex(clusterClient, 'lost-key', {
        ...timeoutOptions,
        onLockLost: onLockLostCallback
      })

      await mutex.acquire()
      expect(mutex.isAcquired).to.be.true

      // Simulate another instance taking the lock
      await clusterClient.set('mutex:lost-key', '222')

      await delay(200)
      expect(mutex.isAcquired).to.be.false
      expect(onLockLostCallback).to.be.called
      expect(onLockLostCallback.firstCall.firstArg instanceof LostLockError).to
        .be.true
    })
  })

  it('should handle mutex reuse in cluster mode', async function () {
    this.timeout(10000)
    const mutex = new Mutex(clusterClient, 'reuse-key', timeoutOptions)

    for (let i = 0; i < 3; i++) {
      await mutex.acquire()
      await delay(300)
      expect(await clusterClient.get('mutex:reuse-key')).to.be.eql(
        mutex.identifier
      )
      await mutex.release()
      expect(await clusterClient.get('mutex:reuse-key')).to.be.eql(null)
      await delay(300)
    }
  })

  it('should handle externally acquired mutex in cluster mode', async () => {
    const externalMutex = new Mutex(clusterClient, 'external-key', {
      ...timeoutOptions,
      refreshInterval: 0
    })

    const localMutex = new Mutex(clusterClient, 'external-key', {
      ...timeoutOptions,
      identifier: externalMutex.identifier,
      acquiredExternally: true
    })

    await externalMutex.acquire()
    await localMutex.acquire()
    await delay(400)
    expect(await clusterClient.get('mutex:external-key')).to.be.eql(
      localMutex.identifier
    )
    await localMutex.release()
    expect(await clusterClient.get('mutex:external-key')).to.be.eql(null)
  })
})
