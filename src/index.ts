import path from 'node:path'

export * from './interfaces'

export * from './services'

export const protoPath = path.resolve(__dirname, '../proto/health.proto')
