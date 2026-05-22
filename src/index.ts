import path from 'node:path'

export * from './interfaces/index.js'

export * from './services/index.js'

export const protoPath: string = path.resolve(import.meta.dirname, '../proto/health.proto')
