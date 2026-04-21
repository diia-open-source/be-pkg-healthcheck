import * as http from 'node:http'

import { mock } from 'vitest-mock-extended'

import { HealthCheckResult, HttpStatusCode, Logger } from '@diia-inhouse/types'

import { HealthCheck } from '../../src'

function httpGet(port: number, path: string): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}${path}`, (res) => {
            let body = ''

            res.on('data', (chunk: Buffer) => {
                body += chunk.toString()
            })
            res.on('end', () => resolve({ statusCode: res.statusCode!, body }))
        }).on('error', reject)
    })
}

describe('HealthCheck HTTP server', () => {
    const logger = mock<Logger>()

    describe('with healthy downstream services', () => {
        const port = 14545
        let healthCheck: HealthCheck

        beforeAll(async () => {
            const container = {
                dbService: {
                    onHealthCheck: async (): Promise<HealthCheckResult<unknown>> => ({
                        status: HttpStatusCode.OK,
                        details: { db: 'connected' },
                    }),
                },
            }

            healthCheck = new HealthCheck(container, { isEnabled: true, port }, logger)
            await healthCheck.onInit()
        })

        afterAll(async () => {
            await healthCheck.onDestroy()
        })

        it('should return 200 with alive status on /live', async () => {
            const { statusCode, body } = await httpGet(port, '/live')

            expect(statusCode).toBe(HttpStatusCode.OK)
            expect(JSON.parse(body)).toEqual({ status: 'alive' })
        })

        it('should return 200 with full details on /readiness', async () => {
            const { statusCode, body } = await httpGet(port, '/readiness')

            expect(statusCode).toBe(HttpStatusCode.OK)
            expect(JSON.parse(body)).toEqual({ db: 'connected' })
        })

        it('should return 200 with full details on /startup', async () => {
            const { statusCode, body } = await httpGet(port, '/startup')

            expect(statusCode).toBe(HttpStatusCode.OK)
            expect(JSON.parse(body)).toEqual({ db: 'connected' })
        })

        it('should return 200 with full details on root path', async () => {
            const { statusCode, body } = await httpGet(port, '/')

            expect(statusCode).toBe(HttpStatusCode.OK)
            expect(JSON.parse(body)).toEqual({ db: 'connected' })
        })
    })

    describe('with unhealthy downstream services', () => {
        const port = 14547
        let healthCheck: HealthCheck

        beforeAll(async () => {
            const container = {
                dbService: {
                    onHealthCheck: async (): Promise<HealthCheckResult<unknown>> => ({
                        status: HttpStatusCode.SERVICE_UNAVAILABLE,
                        details: { db: 'disconnected' },
                    }),
                },
            }

            healthCheck = new HealthCheck(container, { isEnabled: true, port }, logger)
            await healthCheck.onInit()
        })

        afterAll(async () => {
            await healthCheck.onDestroy()
        })

        it('should still return 200 on /live when downstream is unhealthy', async () => {
            const { statusCode, body } = await httpGet(port, '/live')

            expect(statusCode).toBe(HttpStatusCode.OK)
            expect(JSON.parse(body)).toEqual({ status: 'alive' })
        })

        it('should return 503 on /readiness when downstream is unhealthy', async () => {
            const { statusCode, body } = await httpGet(port, '/readiness')

            expect(statusCode).toBe(HttpStatusCode.SERVICE_UNAVAILABLE)
            expect(JSON.parse(body)).toEqual({ db: 'disconnected' })
        })

        it('should return 503 on /startup when downstream is unhealthy', async () => {
            const { statusCode } = await httpGet(port, '/startup')

            expect(statusCode).toBe(HttpStatusCode.SERVICE_UNAVAILABLE)
        })

        it('should return 503 on root path when downstream is unhealthy', async () => {
            const { statusCode } = await httpGet(port, '/')

            expect(statusCode).toBe(HttpStatusCode.SERVICE_UNAVAILABLE)
        })
    })
})
