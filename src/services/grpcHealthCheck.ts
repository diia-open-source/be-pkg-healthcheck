import type * as grpc from '@grpc/grpc-js'
import { loadSync, type ServiceDefinition } from '@grpc/proto-loader'

import { GrpcStatusCode } from '@diia-inhouse/types'

import { generated_health as health } from '../generated'
import { HealthCheckDetails } from '../interfaces'
import { HealthCheck } from './healthcheck'

export class GrpcHealthCheckImplementation {
    private readonly defaultServiceName = ''

    private readonly livenessServiceName = 'live'

    private readonly serviceDefinition: ServiceDefinition

    private watchStatusMap: { [key: string]: health.ServingStatus } = {}

    private watchErrorMap: { [key: string]: Error } = {}

    constructor(
        private readonly healthCheck?: HealthCheck | undefined,
        private statusMap: { [key: string]: health.ServingStatus } = { '': health.ServingStatus.NOT_SERVING },
    ) {
        const loadedProto = loadSync('health.proto', {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
            includeDirs: [`${__dirname}/../../proto`],
        })

        this.serviceDefinition = loadedProto['grpc.health.v1.Health'] as ServiceDefinition
    }

    addToServer(server: grpc.Server): void {
        server.addService(this.serviceDefinition, {
            check: async (
                call: grpc.ServerUnaryCall<health.HealthCheckRequest, health.HealthCheckResponse>,
                callback: (error: grpc.ServiceError | null, result?: health.HealthCheckResponse) => void,
            ): Promise<void> => {
                const service: string = call.request.service

                if (service === this.livenessServiceName) {
                    callback(null, { status: health.ServingStatus.SERVING })

                    return
                }

                if (service !== this.defaultServiceName) {
                    callback({
                        code: GrpcStatusCode.NOT_FOUND,
                        details: `Health status unknown for service ${service}`,
                    } as unknown as grpc.ServiceError)

                    return
                }

                const [status] = await this.getHealth(service)

                callback(null, { status })
            },

            watch: async (
                call: grpc.ServerWritableStream<health.HealthCheckRequest, health.HealthCheckResponse | Error>,
            ): Promise<void> => {
                const service: string = call.request.service

                if (service === this.livenessServiceName) {
                    call.write({ status: health.ServingStatus.SERVING })

                    return
                }

                const interval = setInterval(async () => {
                    let updatedStatus: health.ServingStatus = health.ServingStatus.SERVING
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
                        const [currentStatus] = await this.getHealth(service)
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

    private async getHealth(probe?: string): Promise<[health.ServingStatus, HealthCheckDetails]> {
        if (!this.healthCheck) {
            return [health.ServingStatus.UNKNOWN, {}]
        }

        const { isHealthy, details } = await this.healthCheck.healthcheck(probe)

        return [isHealthy ? health.ServingStatus.SERVING : health.ServingStatus.NOT_SERVING, details]
    }
}
