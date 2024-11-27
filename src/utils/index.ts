import { ClusterOptions, RedisOptions } from 'ioredis'
import { RedisClient } from '../types'
import createEval from './createEval'

export { createEval }

function isRedisOptions(
  options: RedisOptions | ClusterOptions | undefined
): options is RedisOptions {
  return !!options && 'connectionName' in options
}

export async function delay(ms: number) {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

export function getConnectionName(client: RedisClient) {
  const connectionName = isRedisOptions(client.options)
    ? client.options?.connectionName
    : client.options?.redisOptions?.connectionName
  return connectionName ? `<${connectionName}>` : '<unknown client>'
}
