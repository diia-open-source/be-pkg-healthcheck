import * as http from 'http'

import { merge } from 'lodash'

import { HttpStatusCode, Logger, OnHealthCheck, OnInit } from '@diia-inhouse/types'
import { guards } from '@diia-inhouse/utils'

import { HealthCheckConfig, HealthCheckDetails, HealthCheckResponse } from '../interfaces'

export class HealthCheck implements OnInit {
    private readonly healthCheckableServices: OnHealthCheck[] = []

    constructor(
        private readonly container: Record<string, unknown>,
        private readonly healthCheckConfig: HealthCheckConfig,
        private readonly logger: Logger,
    ) {}

    async onInit(): Promise<void> {
        if (!this.healthCheckConfig.isEnabled) {
            this.logger.info('HealthCheck is disabled')

            return
        }

        if (!this.healthCheckableServices.length) {
            for (const instance of Object.values(this.container)) {
                if (guards.hasOnHealthCheckHook(instance)) {
                    this.healthCheckableServices.push(instance)
                }
            }
        }

        const server: http.Server = http.createServer(async (_, res) => {
            const { isHealthy, details } = await this.healthcheck()

            res.statusCode = isHealthy ? HttpStatusCode.OK : HttpStatusCode.SERVICE_UNAVAILABLE

            return res.end(JSON.stringify(details))
        })

        return await new Promise((resolve) => {
            server.listen(this.healthCheckConfig.port, () => {
                this.logger.info(`HealthCheck is running on port ${this.healthCheckConfig.port}`)

                return resolve()
            })
        })
    }

    async healthcheck(): Promise<HealthCheckResponse> {
        let details: HealthCheckDetails = {}
        const statuses = await Promise.all(
            this.healthCheckableServices.map(async (service) => {
                try {
                    const { details: serviceDetails, status } = await service.onHealthCheck()

                    details = merge(details, serviceDetails)

                    return status
                } catch (err) {
                    this.logger.error('Failed to generate healthcheck', { err })

                    return HttpStatusCode.SERVICE_UNAVAILABLE
                }
            }),
        )
        const isHealthy = statuses.every((status) => status === HttpStatusCode.OK)
        if (!isHealthy) {
            this.logger.warn(`HealthCheck unhealthy response`, details)
        }

        return { isHealthy, details }
    }
}
