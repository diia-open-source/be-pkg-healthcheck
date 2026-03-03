import type * as grpc from '@grpc/grpc-js'
import { loadSync, type ServiceDefinition } from '@grpc/proto-loader'

import { GrpcStatusCode } from '@diia-inhouse/types'

import { generated_health as health } from '../generated'
import { HealthCheckDetails } from '../interfaces'
import { HealthCheck } from './healthcheck'

const loadedProto = loadSync('health.proto', {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [`${__dirname}/../../proto`],
})

const defaultServiceName = '' as const

export const service = loadedProto['grpc.health.v1.Health'] as ServiceDefinition

export class GrpcHealthCheckImplementation {
    private watchStatusMap: { [key: string]: health.ServingStatus } = {}
    private watchErrorMap: { [key: string]: Error } = {}

    constructor(
        private readonly healthCheck?: HealthCheck | undefined,
        private statusMap: { [key: string]: health.ServingStatus } = { [defaultServiceName]: health.ServingStatus.NOT_SERVING },
    ) {}

    addToServer(server: grpc.Server): void {
        server.addService(service, {
            check: async (
                call: grpc.ServerUnaryCall<health.HealthCheckRequest, health.HealthCheckResponse>,
                callback: (error: grpc.ServiceError | null, result?: health.HealthCheckResponse) => void,
            ): Promise<void> => {
                const service: string = call.request.service

                if (service !== defaultServiceName) {
                    callback({
                        code: GrpcStatusCode.NOT_FOUND,
                        details: `Health status unknown for service ${service}`,
                    } as unknown as grpc.ServiceError)

                    return
                }

                const [status] = await this.getHealth()

                callback(null, { status })
            },

            watch: async (
                call: grpc.ServerWritableStream<health.HealthCheckRequest, health.HealthCheckResponse | Error>,
            ): Promise<void> => {
                const service: string = call.request.service

                const interval = setInterval(async () => {
                    let updatedStatus = health.ServingStatus.SERVING
                    if (!this.statusMap[service]) {
                        updatedStatus = health.ServingStatus.SERVICE_UNKNOWN
                        this.setStatus(service, updatedStatus)
                        call.write({ status: updatedStatus })
                    }

                    this.watchStatusMap[service] = updatedStatus

                    if (this.watchErrorMap[service]) {
                        clearInterval(interval)
                        call.end(this.watchErrorMap[service])
                    } else {
                        const [currentStatus] = await this.getHealth()
                        const lastStatus = this.statusMap[service] || -1
                        if (lastStatus !== currentStatus) {
                            this.setStatus(service, currentStatus)
                            call.write({ status: currentStatus }, (error?: Error) => {
                                if (error) {
                                    this.watchErrorMap[service] = error
                                }
                            })
                        }
                    }
                }, 1000)
            },
        })
    }

    private setStatus(service: string, status: health.ServingStatus): void {
        this.statusMap[service] = status
    }

    private async getHealth(): Promise<[health.ServingStatus, HealthCheckDetails]> {
        if (!this.healthCheck) {
            return [health.ServingStatus.UNKNOWN, {}]
        }

        const { isHealthy, details } = await this.healthCheck.healthcheck()

        return [isHealthy ? health.ServingStatus.SERVING : health.ServingStatus.NOT_SERVING, details]
    }
}
