# redis-semaphore

[![NPM version][npm-image]][npm-url]
[![Build status][ci-image]][ci-url]
![FOSSA Status][typescript-image]
[![Coverage Status][coverage-image]][coverage-url]
[![Maintainability][codeclimate-image]][codeclimate-url]
[![Known Vulnerabilities][snyk-image]][snyk-url]
[![FOSSA Status][fossa-badge-image]][fossa-badge-url]

[Mutex](<https://en.wikipedia.org/wiki/Lock_(computer_science)>) and [Semaphore](<https://en.wikipedia.org/wiki/Semaphore_(programming)>) implementations based on [Redis](https://redis.io/) ready for distributed systems

## Features

- Fail-safe (all actions performed by LUA scripts (atomic))

## Usage

### Installation

```bash
npm install --save redis-semaphore ioredis
# or
yarn add redis-semaphore ioredis
```

ioredis is the officially supported Redis client. This library's test code runs on it.

Users of other Redis clients should ensure ioredis-compatible API (see src/types.ts) when creating lock objects.

### Mutex

> See [RedisLabs: Locks with timeouts](https://redislabs.com/ebook/part-2-core-concepts/chapter-6-application-components-in-redis/6-2-distributed-locking/6-2-5-locks-with-timeouts/)

##### new Mutex(redisClient, key [, { lockTimeout = 10000, acquireTimeout = 10000, acquireAttemptsLimit = Number.POSITIVE_INFINITY, retryInterval = 10, refreshInterval = lockTimeout * 0.8, identifier = crypto.randomUUID() }])

- `redisClient` - **required**, configured `redis` client
- `key` - **required**, key for locking resource (final key in redis: `mutex:<key>`)
- `options` - _optional_
  - `lockTimeout` - _optional_ ms, time after mutex will be auto released (expired)
  - `acquireTimeout` - _optional_ ms, max timeout for `.acquire()` call
  - `acquireAttemptsLimit` - _optional_ max number of attempts to be made in `.acquire()` call
  - `retryInterval` - _optional_ ms, time between acquire attempts if resource locked
  - `refreshInterval` - _optional_ ms, auto-refresh interval; to disable auto-refresh behaviour set `0`
  - `identifier` - _optional_ uuid, custom mutex identifier. Must be unique between parallel executors, otherwise multiple locks with same identifier *can* be treated as the same lock holder. Override only if you know what you are doing (see `acquiredExternally` option).
  - `acquiredExternally` - _optional_ `true`, If `identifier` provided and `acquiredExternally` is `true` then `_refresh` will be used instead of `_acquire` in `.tryAcquire()`/`.acquire()`. Useful for lock sharing between processes: acquire in scheduler, refresh and release in handler.
  - `onLockLost` - _optional_ function, called when lock loss is detected due refresh cycle; default onLockLost throws unhandled LostLockError

#### Example

```javascript
const Mutex = require('redis-semaphore').Mutex
const Redis = require('ioredis')

// TypeScript
// import { Mutex } from 'redis-semaphore'
// import Redis from 'ioredis'

const redisClient = new Redis()

async function doSomething() {
  const mutex = new Mutex(redisClient, 'lockingResource')
  await mutex.acquire()
  try {
    // critical code
  } finally {
    await mutex.release()
  }
}
```

#### Example with lost lock handling

```javascript
async function doSomething() {
  const mutex = new Mutex(redisClient, 'lockingResource', {
    // By default onLockLost throws unhandled LostLockError
    onLockLost(err) {
      console.error(err)
    }
  })
  await mutex.acquire()
  try {
    while (mutex.isAcquired) {
      // critical cycle iteration
    }
  } finally {
    // It's safe to always call release, because if lock is no longer belongs to this mutex, .release() will have no effect
    await mutex.release()
  }
}
```

#### Example with optional lock

```javascript
async function doSomething() {
  const mutex = new Mutex(redisClient, 'lockingResource', {
    acquireAttemptsLimit: 1
  })
  const lockAcquired = await mutex.tryAcquire()
  if (!lockAcquired) {
    return
  }
  try {
    while (mutex.isAcquired) {
      // critical cycle iteration
    }
  } finally {
    // It's safe to always call release, because if lock is no longer belongs to this mutex, .release() will have no effect
    await mutex.release()
  }
}
```

#### Example with temporary refresh

```javascript
async function doSomething() {
  const mutex = new Mutex(redisClient, 'lockingResource', {
    lockTimeout: 120000,
    refreshInterval: 15000
  })
  const lockAcquired = await mutex.tryAcquire()
  if (!lockAcquired) {
    return
  }
  try {
    // critical cycle iteration
  } finally {
    // We want to let lock expire over time after operation is finished
    await mutex.stopRefresh()
  }
}
```

#### Example with dynamically adjusting existing lock

```javascript
const Mutex = require('redis-semaphore').Mutex
const Redis = require('ioredis')

// TypeScript
// import { Mutex } from 'redis-semaphore'
// import Redis from 'ioredis'

const redisClient = new Redis()

// This creates an original lock
const preMutex = new Mutex(redisClient, 'lockingResource', {
  lockTimeout: 10 * 1e3, // lock for 10s
  refreshInterval: 0
});

// This modifies lock with a new TTL and starts refresh
const mutex = new Mutex(redisClient, 'lockingResource', {
  identifier: preMutex.identifier,
  acquiredExternally: true, // required in this case
  lockTimeout: 30 * 60 * 1e3, // lock for 30min
  refreshInterval: 60 * 1e3
});

```

#### Example with shared lock between scheduler and handler apps

```javascript
const Mutex = require('redis-semaphore').Mutex
const Redis = require('ioredis')

// TypeScript
// import { Mutex } from 'redis-semaphore'
// import Redis from 'ioredis'

const redisClient = new Redis()

// scheduler app code
async function every10MinutesCronScheduler() {
  const mutex = new Mutex(redisClient, 'lockingResource', {
    lockTimeout: 30 * 60 * 1e3, // lock for 30min
    refreshInterval: 0
  })
  if (await mutex.tryAcquire()) {
    someQueue.publish({ mutexIdentifier: mutex.identifier })
  } else {
    logger.info('Job already scheduled. Do nothing in current cron cycle')
  }
}

// handler app code
async function queueHandler(queueMessageData) {
  const { mutexIdentifier } = queueMessageData
  const mutex = new Mutex(redisClient, 'lockingResource', {
    lockTimeout: 10 * 1e3, // 10sec
    identifier: mutexIdentifier,
    acquiredExternally: true // required in this case
  })

  // actually will do `refresh` with new lockTimeout instead of acquire
  // if mutex was locked by another process or lock was expired - exception will be thrown (default refresh behavior)
  await mutex.acquire()

  try {
    // critical code
  } finally {
    await mutex.release()
  }
}
```

### Semaphore

> See [RedisLabs: Basic counting sempahore](https://redislabs.com/ebook/part-2-core-concepts/chapter-6-application-components-in-redis/6-3-counting-semaphores/6-3-1-building-a-basic-counting-semaphore/)

This implementation is slightly different from the algorithm described in the book, but the main idea has not changed.

`zrank` check replaced with `zcard`, so now it is fair as [RedisLabs: Fair semaphore](https://redislabs.com/ebook/part-2-core-concepts/chapter-6-application-components-in-redis/6-3-counting-semaphores/6-3-2-fair-semaphores/) (see tests).

In edge cases (node time difference is greater than `lockTimeout`) both algorithms are not fair due cleanup stage (removing expired members from sorted set), so `FairSemaphore` API has been removed (it's safe to replace it with `Semaphore`).

Most reliable way to use: `lockTimeout` is greater than possible node clock differences, `refreshInterval` is not 0 and is less enough than `lockTimeout` (by default is `lockTimeout * 0.8`)

##### new Semaphore(redisClient, key, maxCount [, { lockTimeout = 10000, acquireTimeout = 10000, acquireAttemptsLimit = Number.POSITIVE_INFINITY, retryInterval = 10, refreshInterval = lockTimeout * 0.8 }])

- `redisClient` - **required**, configured `redis` client
- `key` - **required**, key for locking resource (final key in redis: `semaphore:<key>`)
- `maxCount` - **required**, maximum simultaneously resource usage count
- `options` _optional_ See `Mutex` options

#### Example

```javascript
const Semaphore = require('redis-semaphore').Semaphore
const Redis = require('ioredis')

// TypeScript
// import { Semaphore } from 'redis-semaphore'
// import Redis from 'ioredis'

const redisClient = new Redis()

async function doSomething() {
  const semaphore = new Semaphore(redisClient, 'lockingResource', 5)
  await semaphore.acquire()
  try {
    // maximum 5 simultaneously executions
  } finally {
    await semaphore.release()
  }
}
```

### MultiSemaphore

Same as `Semaphore` with one difference - MultiSemaphore will try to acquire multiple permits instead of one.

`MultiSemaphore` and `Semaphore` shares same key namespace and can be used together (see test/src/RedisMultiSemaphore.test.ts).

##### new MultiSemaphore(redisClient, key, maxCount, permits [, { lockTimeout = 10000, acquireTimeout = 10000, acquireAttemptsLimit = Number.POSITIVE_INFINITY, retryInterval = 10, refreshInterval = lockTimeout * 0.8 }])

- `redisClient` - **required**, configured `redis` client
- `key` - **required**, key for locking resource (final key in redis: `semaphore:<key>`)
- `maxCount` - **required**, maximum simultaneously resource usage count
- `permits` - **required**, number of acquiring permits
- `options` _optional_ See `Mutex` options

#### Example

```javascript
const MultiSemaphore = require('redis-semaphore').MultiSemaphore
const Redis = require('ioredis')

// TypeScript
// import { MultiSemaphore } from 'redis-semaphore'
// import Redis from 'ioredis'

const redisClient = new Redis()

async function doSomething() {
  const semaphore = new MultiSemaphore(redisClient, 'lockingResource', 5, 2)

  await semaphore.acquire()
  try {
    // make 2 parallel calls to remote service which allow only 5 simultaneously calls
  } finally {
    await semaphore.release()
  }
}
```

### RedlockMutex

Distributed `Mutex` version

> See [The Redlock algorithm](https://redis.io/topics/distlock#the-redlock-algorithm)

##### new RedlockMutex(redisClients, key [, { lockTimeout = 10000, acquireTimeout = 10000, acquireAttemptsLimit = Number.POSITIVE_INFINITY, retryInterval = 10, refreshInterval = lockTimeout * 0.8 }])

- `redisClients` - **required**, array of configured `redis` client connected to independent nodes
- `key` - **required**, key for locking resource (final key in redis: `mutex:<key>`)
- `options` _optional_ See `Mutex` options

#### Example

```javascript
const RedlockMutex = require('redis-semaphore').RedlockMutex
const Redis = require('ioredis')

// TypeScript
// import { RedlockMutex } from 'redis-semaphore'
// import Redis from 'ioredis'

const redisClients = [
  new Redis('127.0.0.1:6377'),
  new Redis('127.0.0.1:6378'),
  new Redis('127.0.0.1:6379')
] // or cluster.nodes('master')

async function doSomething() {
  const mutex = new RedlockMutex(redisClients, 'lockingResource')
  await mutex.acquire()
  try {
    // critical code
  } finally {
    await mutex.release()
  }
}
```

### RedlockSemaphore

Distributed `Semaphore` version

> See [The Redlock algorithm](https://redis.io/topics/distlock#the-redlock-algorithm)

##### new RedlockSemaphore(redisClients, key, maxCount [, { lockTimeout = 10000, acquireTimeout = 10000, acquireAttemptsLimit = Number.POSITIVE_INFINITY, retryInterval = 10, refreshInterval = lockTimeout * 0.8 }])

- `redisClients` - **required**, array of configured `redis` client connected to independent nodes
- `key` - **required**, key for locking resource (final key in redis: `semaphore:<key>`)
- `maxCount` - **required**, maximum simultaneously resource usage count
- `options` _optional_ See `Mutex` options

#### Example

```javascript
const RedlockSemaphore = require('redis-semaphore').RedlockSemaphore
const Redis = require('ioredis')

// TypeScript
// import { RedlockSemaphore } from 'redis-semaphore'
// import Redis from 'ioredis'

const redisClients = [
  new Redis('127.0.0.1:6377'),
  new Redis('127.0.0.1:6378'),
  new Redis('127.0.0.1:6379')
] // or cluster.nodes('master')

async function doSomething() {
  const semaphore = new Semaphore(redisClients, 'lockingResource', 5)
  await semaphore.acquire()
  try {
    // maximum 5 simultaneously executions
  } finally {
    await semaphore.release()
  }
}
```

### RedlockMultiSemaphore

Distributed `MultiSemaphore` version

> See [The Redlock algorithm](https://redis.io/topics/distlock#the-redlock-algorithm)

##### new RedlockMultiSemaphore(redisClients, key, maxCount, permits [, { lockTimeout = 10000, acquireTimeout = 10000, acquireAttemptsLimit = Number.POSITIVE_INFINITY, retryInterval = 10, refreshInterval = lockTimeout * 0.8 }])

- `redisClients` - **required**, array of configured `redis` client connected to independent nodes
- `key` - **required**, key for locking resource (final key in redis: `semaphore:<key>`)
- `maxCount` - **required**, maximum simultaneously resource usage count
- `permits` - **required**, number of acquiring permits
- `options` _optional_ See `Mutex` options

#### Example

```javascript
const RedlockMultiSemaphore = require('redis-semaphore').RedlockMultiSemaphore
const Redis = require('ioredis')

// TypeScript
// import { RedlockMultiSemaphore } from 'redis-semaphore'
// import Redis from 'ioredis'

const redisClients = [
  new Redis('127.0.0.1:6377'),
  new Redis('127.0.0.1:6378'),
  new Redis('127.0.0.1:6379')
] // or cluster.nodes('master')

async function doSomething() {
  const semaphore = new RedlockMultiSemaphore(
    redisClients,
    'lockingResource',
    5,
    2
  )

  await semaphore.acquire()
  try {
    // make 2 parallel calls to remote service which allow only 5 simultaneously calls
  } finally {
    await semaphore.release()
  }
}
```

## Development

```shell
yarn --immutable
./setup-redis-servers.sh
yarn dev
```

## License

MIT

[![FOSSA Status][fossa-large-image]][fossa-large-url]

[npm-image]: https://img.shields.io/npm/v/redis-semaphore.svg?style=flat-square
[npm-url]: https://npmjs.org/package/redis-semaphore
[ci-image]: https://github.com/swarthy/redis-semaphore/actions/workflows/branches.yml/badge.svg
[ci-url]: https://github.com/swarthy/redis-semaphore/actions/workflows/branches.yml
[codeclimate-image]: https://api.codeclimate.com/v1/badges/02778c96bb5983eb150c/maintainability
[codeclimate-url]: https://codeclimate.com/github/swarthy/redis-semaphore/maintainability
[snyk-image]: https://snyk.io/test/npm/redis-semaphore/badge.svg
[snyk-url]: https://snyk.io/test/npm/redis-semaphore
[coverage-image]: https://coveralls.io/repos/github/swarthy/redis-semaphore/badge.svg?branch=master
[coverage-url]: https://coveralls.io/r/swarthy/redis-semaphore?branch=master
[fossa-badge-image]: https://app.fossa.com/api/projects/custom%2B10538%2Fgit%40github.com%3Aswarthy%2Fredis-semaphore.git.svg?type=shield
[fossa-badge-url]: https://app.fossa.com/projects/custom%2B10538%2Fgit%40github.com%3Aswarthy%2Fredis-semaphore.git?ref=badge_shield
[fossa-large-image]: https://app.fossa.com/api/projects/custom%2B10538%2Fgit%40github.com%3Aswarthy%2Fredis-semaphore.git.svg?type=large
[fossa-large-url]: https://app.fossa.com/projects/custom%2B10538%2Fgit%40github.com%3Aswarthy%2Fredis-semaphore.git?ref=badge_large
[typescript-image]: https://badgen.net/npm/types/tslib
