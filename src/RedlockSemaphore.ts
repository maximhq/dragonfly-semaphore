import Redis from 'ioredis'

import { TimeoutOptions } from './misc'
import RedlockMutex from './RedlockMutex'
import { acquireRedlockSemaphore } from './redlockSemaphore/acquire'
import { refreshRedlockSemaphore } from './redlockSemaphore/refresh'
import { releaseRedlockSemaphore } from './redlockSemaphore/release'

export default class RedlockSemaphore extends RedlockMutex {
  protected _kind = 'redlock-semaphore'
  protected _limit: number

  constructor(
    clients: Redis.Redis[],
    key: string,
    limit: number,
    options?: TimeoutOptions
  ) {
    super(clients, key, options)
    if (!limit) {
      throw new Error('"limit" is required')
    }
    if (typeof limit !== 'number') {
      throw new Error('"limit" must be a number')
    }
    this._key = `semaphore:${key}`
    this._limit = limit
  }

  protected async _refresh() {
    return await refreshRedlockSemaphore(
      this._clients,
      this._key,
      this._limit,
      this._acquireOptions
    )
  }

  protected async _acquire() {
    return await acquireRedlockSemaphore(
      this._clients,
      this._key,
      this._limit,
      this._acquireOptions
    )
  }

  protected async _release() {
    await releaseRedlockSemaphore(this._clients, this._key, this._identifier)
  }
}
