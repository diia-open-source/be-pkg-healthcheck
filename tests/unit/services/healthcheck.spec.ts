import * as http from 'node:http'

import { mock } from 'vitest-mock-extended'

import { HttpStatusCode, Logger } from '@diia-inhouse/types'

import { HealthCheck, HealthCheckDetails } from '../../../src'

const healthCheckConfig = {
    isEnabled: true,
    port: 4567,
}

const res = {
    end: vi.fn(),
    statusCode: undefined,
}

let executeRequest: () => Promise<void>

vi.mock('node:http', () => {
    return {
        __esModule: true,
        createServer: (cb1: (_req: unknown, _res: unknown) => unknown): unknown => {
            executeRequest = async (): Promise<void> => {
                await cb1(undefined, res)
            }

            return {
                listen: (_port: number, cb2: () => void) => cb2(),
            }
        },
    }
})

describe('Service Healthcheck', () => {
    const loggerMock = mock<Logger>()

    beforeEach(() => {
        res.end.mockReset()
    })
    describe('method: `onInit`', () => {
        it('should create server', async () => {
            const spy = vi.spyOn(http, 'createServer')
            const service = new HealthCheck({}, healthCheckConfig, loggerMock)

            await service.onInit()

            expect(spy).toHaveBeenCalled()
        })

        it('should skip if healthcheck is not enabled', async () => {
            const createServerSpy = vi.spyOn(http, 'createServer')
            const loggerSpy = vi.spyOn(loggerMock, 'info')

            const service = new HealthCheck({}, { ...healthCheckConfig, isEnabled: false }, loggerMock)

            await service.onInit()

            expect(loggerSpy).toHaveBeenCalledWith('HealthCheck is disabled')
            expect(createServerSpy).toHaveBeenCalledTimes(0)
        })

        it('created server should respond on healtcheckable services', async () => {
            const container = {
                service1: {
                    onHealthCheck: (): HealthCheckDetails => ({
                        details: { item1: 'item1', item2: 'item2' },
                        status: HttpStatusCode.OK,
                    }),
                },
                service2: {
                    onHealthCheck: (): HealthCheckDetails => ({
                        details: { item3: 'item3', item4: 'item4' },
                        status: HttpStatusCode.OK,
                    }),
                },
            }
            const service = new HealthCheck(container, healthCheckConfig, loggerMock)

            await service.onInit()

            await executeRequest()

            expect(res.end).toHaveBeenCalledWith(
                JSON.stringify({
                    item1: 'item1',
                    item2: 'item2',
                    item3: 'item3',
                    item4: 'item4',
                }),
            )
            expect(res.statusCode).toEqual(HttpStatusCode.OK)
        })

        it('created server should respond with 503 status if any service responds with not OK status', async () => {
            const container = {
                service1: {
                    onHealthCheck: (): HealthCheckDetails => ({
                        details: { item1: 'item1', item2: 'item2' },
                        status: HttpStatusCode.OK,
                    }),
                },
                service2: {
                    onHealthCheck: (): HealthCheckDetails => ({
                        details: { item3: 'item3', item4: 'item4' },
                        status: HttpStatusCode.SERVICE_UNAVAILABLE,
                    }),
                },
            }
            const service = new HealthCheck(container, healthCheckConfig, loggerMock)

            await service.onInit()

            await executeRequest()

            expect(res.end).toHaveBeenCalledWith(
                JSON.stringify({
                    item1: 'item1',
                    item2: 'item2',
                    item3: 'item3',
                    item4: 'item4',
                }),
            )
            expect(res.statusCode).toEqual(HttpStatusCode.SERVICE_UNAVAILABLE)
        })

        it('should respond with 500 status if error occured on health status calculation', async () => {
            const expectedErrorMessage = 'Failed to generate healthcheck'
            const expectedError = new Error('Unable to fetch health status')
            const container = {
                service1: {
                    onHealthCheck: (): HealthCheckDetails => {
                        throw expectedError
                    },
                },
            }
            const service = new HealthCheck(container, healthCheckConfig, loggerMock)

            await service.onInit()

            await executeRequest()

            expect(res.end).toHaveBeenCalledWith('{}')
            expect(res.statusCode).toEqual(HttpStatusCode.SERVICE_UNAVAILABLE)
            expect(loggerMock.error).toHaveBeenCalledWith(expectedErrorMessage, { err: expectedError })
        })
    })

    describe('method: `addHealthCheckable`', () => {
        it('should add service to health check after initialization', async () => {
            const container = {
                service1: {
                    onHealthCheck: (): HealthCheckDetails => ({
                        details: { item1: 'item1' },
                        status: HttpStatusCode.OK,
                    }),
                },
            }
            const service = new HealthCheck(container, healthCheckConfig, loggerMock)

            await service.onInit()

            service.addHealthCheckable({
                onHealthCheck: async () => ({
                    details: { dynamicItem: 'dynamicValue' },
                    status: HttpStatusCode.OK,
                }),
            })

            await executeRequest()

            expect(res.end).toHaveBeenCalledWith(
                JSON.stringify({
                    item1: 'item1',
                    dynamicItem: 'dynamicValue',
                }),
            )
            expect(res.statusCode).toEqual(HttpStatusCode.OK)
        })

        it('should include dynamically added service in unhealthy status check', async () => {
            const container = {
                service1: {
                    onHealthCheck: (): HealthCheckDetails => ({
                        details: { item1: 'item1' },
                        status: HttpStatusCode.OK,
                    }),
                },
            }
            const service = new HealthCheck(container, healthCheckConfig, loggerMock)

            await service.onInit()

            service.addHealthCheckable({
                onHealthCheck: async () => ({
                    details: { worker: 'FAILED' },
                    status: HttpStatusCode.SERVICE_UNAVAILABLE,
                }),
            })

            await executeRequest()

            expect(res.statusCode).toEqual(HttpStatusCode.SERVICE_UNAVAILABLE)
        })
    })
})
