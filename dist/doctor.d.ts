import type { DiscoverRootsOptions } from "./router.js";
export type DoctorSeverity = "error" | "warning" | "info";
export interface DoctorProblem {
    severity: DoctorSeverity;
    code: string;
    message: string;
    path?: string;
}
export interface DoctorReport {
    version: 1;
    problems: DoctorProblem[];
    summary: {
        errors: number;
        warnings: number;
        infos: number;
    };
}
export declare function runDoctor(options?: DiscoverRootsOptions): Promise<DoctorReport>;
export declare function renderDoctorReport(report: DoctorReport): string;
//# sourceMappingURL=doctor.d.ts.map