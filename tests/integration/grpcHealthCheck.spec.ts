import { ChannelCredentials, Server, ServerCredentials, loadPackageDefinition } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import { mock } from 'vitest-mock-extended'

import { HealthCheckResult, HttpStatusCode, Logger } from '@diia-inhouse/types'

import { GrpcHealthCheckImplementation, HealthCheck } from '../../src'

interface HealthCheckClient {
    check(
        request: { service: string },
        callback: (error: { code: number; details: string } | null, response: { status: string }) => void,
    ): void
    close(): void
}

function createClient(port: number): HealthCheckClient {
    const pkgDefs = loadSync('health.proto', {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [`${__dirname}/../../proto`],
    })
    const proto = loadPackageDefinition(pkgDefs)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const HealthService = (proto.grpc as any).health.v1.Health

    return new HealthService(`localhost:${port}`, ChannelCredentials.createInsecure())
}

function grpcCheck(client: HealthCheckClient, service: string): Promise<{ status: string }> {
    return new Promise((resolve, reject) => {
        client.check({ service }, (error, response) => {
            if (error) {
                reject(error)
            } else {
                resolve(response)
            }
        })
    })
}

describe('GrpcHealthCheck integration', () => {
    const logger = mock<Logger>()
    const grpcPort = 14546

    let server: Server
    let client: HealthCheckClient

    afterEach(async () => {
        client?.close?.()
        await new Promise<void>((resolve, reject) => {
            server?.tryShutdown((err) => (err ? reject(err) : resolve()))
        })
    })

    describe('with healthy downstream services', () => {
        beforeEach(async () => {
            const container = {
                dbService: {
                    onHealthCheck: async (): Promise<HealthCheckResult<unknown>> => ({
                        status: HttpStatusCode.OK,
                        details: { db: 'connected' },
                    }),
                },
            }

            const healthCheck = new HealthCheck(container, { isEnabled: false, port: 0 }, logger)

            await healthCheck.onInit()

            server = new Server()
            const grpcHealth = new GrpcHealthCheckImplementation(healthCheck)

            grpcHealth.addToServer(server)

            await new Promise<void>((resolve, reject) => {
                server.bindAsync(`0.0.0.0:${grpcPort}`, ServerCredentials.createInsecure(), (err) => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                })
            })

            client = createClient(grpcPort)
        })

        it('should return SERVING for default service name', async () => {
            const response = await grpcCheck(client, '')

            expect(response.status).toBe('SERVING')
        })

        it('should return SERVING for live service name', async () => {
            const response = await grpcCheck(client, 'live')

            expect(response.status).toBe('SERVING')
        })

        it('should return NOT_FOUND for unknown service name', async () => {
            await expect(grpcCheck(client, 'unknown')).rejects.toMatchObject({ code: 5 })
        })
    })

    describe('with unhealthy downstream services', () => {
        beforeEach(async () => {
            const container = {
                dbService: {
                    onHealthCheck: async (): Promise<HealthCheckResult<unknown>> => ({
                        status: HttpStatusCode.SERVICE_UNAVAILABLE,
                        details: { db: 'disconnected' },
                    }),
                },
            }

            const healthCheck = new HealthCheck(container, { isEnabled: false, port: 0 }, logger)

            await healthCheck.onInit()

            server = new Server()
            const grpcHealth = new GrpcHealthCheckImplementation(healthCheck)

            grpcHealth.addToServer(server)

            await new Promise<void>((resolve, reject) => {
                server.bindAsync(`0.0.0.0:${grpcPort}`, ServerCredentials.createInsecure(), (err) => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                })
            })

            client = createClient(grpcPort)
        })

        it('should return NOT_SERVING for default service name', async () => {
            const response = await grpcCheck(client, '')

            expect(response.status).toBe('NOT_SERVING')
        })

        it('should still return SERVING for live service name', async () => {
            const response = await grpcCheck(client, 'live')

            expect(response.status).toBe('SERVING')
        })
    })
})
