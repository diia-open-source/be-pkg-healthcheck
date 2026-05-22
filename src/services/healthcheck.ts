import * as http from 'node:http'

import lodash from 'lodash'

import { HttpStatusCode, Logger, OnDestroy, OnHealthCheck, OnInit } from '@diia-inhouse/types'
/* oxlint-disable-next-line eslint/no-restricted-imports -- leaf library; consumers cannot inject utils via DI */
import { guards } from '@diia-inhouse/utils'

import { HealthCheckConfig, HealthCheckDetails, HealthCheckResponse } from '../interfaces/index.js'

export class HealthCheck implements OnInit, OnDestroy {
    private static readonly LIVENESS_PATH = '/live'

    private readonly healthCheckableServices: OnHealthCheck[] = []

    private server?: http.Server

    constructor(
        private readonly container: Record<string, unknown>,
        private readonly healthCheckConfig: HealthCheckConfig,
        private readonly logger: Logger,
    ) {}

    addHealthCheckable(service: OnHealthCheck): void {
        this.healthCheckableServices.push(service)
    }

    async onInit(): Promise<void> {
        if (this.healthCheckableServices.length === 0) {
            for (const instance of Object.values(this.container)) {
                if (guards.hasOnHealthCheckHook(instance)) {
                    this.healthCheckableServices.push(instance)
                }
            }
        }

        if (!this.healthCheckConfig.isEnabled) {
            this.logger.info('HealthCheck is disabled')

            return
        }

        this.server = http.createServer(async (req, res) => {
            if (req.url === HealthCheck.LIVENESS_PATH) {
                res.statusCode = HttpStatusCode.OK

                return res.end(JSON.stringify({ status: 'alive' }))
            }

            const { isHealthy, details } = await this.healthcheck(req.url)

            res.statusCode = isHealthy ? HttpStatusCode.OK : HttpStatusCode.SERVICE_UNAVAILABLE

            return res.end(JSON.stringify(details))
        })

        return await new Promise((resolve) => {
            this.server!.listen(this.healthCheckConfig.port, () => {
                this.logger.info(`HealthCheck is running on port ${this.healthCheckConfig.port}`)

                return resolve()
            })
        })
    }

    async onDestroy(): Promise<void> {
        if (!this.server) {
            return
        }

        return await new Promise((resolve, reject) => {
            // oxlint-disable-next-line eslint-plugin-promise/no-multiple-resolved -- ternary; reject and resolve are mutually exclusive per callback
            this.server!.close((err) => (err ? reject(err) : resolve()))
        })
    }

    async healthcheck(probe?: string): Promise<HealthCheckResponse> {
        let details: HealthCheckDetails = {}
        const statuses = await Promise.all(
            this.healthCheckableServices.map(async (service) => {
                try {
                    const { details: serviceDetails, status } = await service.onHealthCheck()

                    details = lodash.merge(details, serviceDetails)

                    return status
                } catch (err) {
                    this.logger.error('Failed to generate healthcheck', { err })

                    return HttpStatusCode.SERVICE_UNAVAILABLE
                }
            }),
        )
        const isHealthy = statuses.every((status) => status === HttpStatusCode.OK)
        if (!isHealthy) {
            this.logger.warn(`HealthCheck unhealthy response`, { probe, ...details })
        }

        return { isHealthy, details }
    }
}
