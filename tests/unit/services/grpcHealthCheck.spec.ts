import { mock } from 'vitest-mock-extended'

import { GrpcStatusCode } from '@diia-inhouse/types'

import { generated_health as health } from '../../../src/generated'
import { GrpcHealthCheckImplementation } from '../../../src/services/grpcHealthCheck'
import { HealthCheck } from '../../../src/services/healthcheck'

describe('GrpcHealthCheckImplementation', () => {
    describe('check', () => {
        it('should run full health check for default (empty) service name', async () => {
            const healthCheck = mock<HealthCheck>()

            healthCheck.healthcheck.mockResolvedValue({ isHealthy: true, details: { db: 'ok' } })

            const grpcHealth = new GrpcHealthCheckImplementation(healthCheck)
            const server = { addService: vi.fn() }

            grpcHealth.addToServer(server as never)

            const checkHandler = server.addService.mock.calls[0][1].check
            const callback = vi.fn()

            await checkHandler({ request: { service: '' } }, callback)

            expect(healthCheck.healthcheck).toHaveBeenCalled()
            expect(callback).toHaveBeenCalledWith(null, { status: health.ServingStatus.SERVING })
        })

        it('should return SERVING immediately for "live" service name without calling healthcheck', async () => {
            const healthCheck = mock<HealthCheck>()
            const grpcHealth = new GrpcHealthCheckImplementation(healthCheck)
            const server = { addService: vi.fn() }

            grpcHealth.addToServer(server as never)

            const checkHandler = server.addService.mock.calls[0][1].check
            const callback = vi.fn()

            await checkHandler({ request: { service: 'live' } }, callback)

            expect(healthCheck.healthcheck).not.toHaveBeenCalled()
            expect(callback).toHaveBeenCalledWith(null, { status: health.ServingStatus.SERVING })
        })

        it('should return NOT_FOUND for unknown service name', async () => {
            const healthCheck = mock<HealthCheck>()
            const grpcHealth = new GrpcHealthCheckImplementation(healthCheck)
            const server = { addService: vi.fn() }

            grpcHealth.addToServer(server as never)

            const checkHandler = server.addService.mock.calls[0][1].check
            const callback = vi.fn()

            await checkHandler({ request: { service: 'unknown-service' } }, callback)

            expect(healthCheck.healthcheck).not.toHaveBeenCalled()
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: GrpcStatusCode.NOT_FOUND }))
        })

        it('should return NOT_SERVING when healthcheck reports unhealthy', async () => {
            const healthCheck = mock<HealthCheck>()

            healthCheck.healthcheck.mockResolvedValue({ isHealthy: false, details: { db: 'disconnected' } })

            const grpcHealth = new GrpcHealthCheckImplementation(healthCheck)
            const server = { addService: vi.fn() }

            grpcHealth.addToServer(server as never)

            const checkHandler = server.addService.mock.calls[0][1].check
            const callback = vi.fn()

            await checkHandler({ request: { service: '' } }, callback)

            expect(callback).toHaveBeenCalledWith(null, { status: health.ServingStatus.NOT_SERVING })
        })

        it('should return UNKNOWN when no healthCheck instance is provided', async () => {
            const grpcHealth = new GrpcHealthCheckImplementation(undefined)
            const server = { addService: vi.fn() }

            grpcHealth.addToServer(server as never)

            const checkHandler = server.addService.mock.calls[0][1].check
            const callback = vi.fn()

            await checkHandler({ request: { service: '' } }, callback)

            expect(callback).toHaveBeenCalledWith(null, { status: health.ServingStatus.UNKNOWN })
        })
    })
})
