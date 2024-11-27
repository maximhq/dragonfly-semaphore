import { expect } from 'chai'

import { releaseSemaphore as release } from '../../../src/semaphore/release'
import { client1 as client, clusterClient } from '../../redisClient'

describe('semaphore release', () => {
  it('should remove key after success release', async () => {
    await client.zadd('key', '' + Date.now(), '111')
    expect(await client.zcard('key')).to.be.eql(1)
    await release(client, 'key', '111')
    expect(await client.zcard('key')).to.be.eql(0)
  })
  it('should do nothing if resource is not locked', async () => {
    expect(await client.zcard('key')).to.be.eql(0)
    await release(client, 'key', '111')
    expect(await client.zcard('key')).to.be.eql(0)
  })
})

describe('semaphore release with Redis cluster', () => {
  it('should remove key after success release in cluster', async () => {
    await clusterClient.zadd('cluster-key', '' + Date.now(), '111')
    expect(await clusterClient.zcard('cluster-key')).to.be.eql(1)
    await release(clusterClient, 'cluster-key', '111')
    expect(await clusterClient.zcard('cluster-key')).to.be.eql(0)
  })

  it('should do nothing if resource is not locked in cluster', async () => {
    expect(await clusterClient.zcard('cluster-key')).to.be.eql(0)
    await release(clusterClient, 'cluster-key', '111')
    expect(await clusterClient.zcard('cluster-key')).to.be.eql(0)
  })
})