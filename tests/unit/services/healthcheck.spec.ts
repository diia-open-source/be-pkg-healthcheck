import * as http from 'http'

import { HttpStatusCode, Logger } from '@diia-inhouse/types'

import { HealthCheck, HealthCheckDetails } from '../../../src'

const healthCheckConfig = {
    isEnabled: true,
    port: 4567,
}

const loggerMock = <Logger>(<unknown>{
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
})

const res = {
    end: jest.fn(),
    statusCode: undefined,
}

let executeRequest: () => Promise<void>

jest.mock('http', () => {
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
    beforeEach(() => {
        res.end.mockReset()
    })
    describe('method: `onInit`', () => {
        it('should create server', async () => {
            const spy = jest.spyOn(http, 'createServer')
            const service = new HealthCheck({}, healthCheckConfig, loggerMock)

            await service.onInit()

            expect(spy).toHaveBeenCalled()
        })

        it('should skip if healthcheck is not enabled', async () => {
            const createServerSpy = jest.spyOn(http, 'createServer')
            const loggerSpy = jest.spyOn(loggerMock, 'info')

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
})
