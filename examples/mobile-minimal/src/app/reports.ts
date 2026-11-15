/**
 * Trail reports walkers leave on a trail's page. In memory, so they reset when the server
 * restarts; a real app would write a database, and the form would not change.
 */
export interface TrailReport {
  trail: string;
  name: string;
  text: string;
}

export const REPORT_MAX = 280;

const reports: TrailReport[] = [];

export function reportsFor(trail: string): TrailReport[] {
  return reports.filter((report) => report.trail === trail).reverse();
}

export function addReport(report: TrailReport): void {
  reports.push(report);
}
