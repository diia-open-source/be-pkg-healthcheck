export type HealthCheckDetails = Record<string, unknown>

export interface HealthCheckResponse {
    isHealthy: boolean
    details: HealthCheckDetails
}
