export type Mode = 'demo' | 'live';
export type JobStatus = 'new' | 'skipped' | 'needs_resume' | 'ready' | 'needs_manual' | 'submitted' | 'failed';
export interface Match { score: number; matched: string[]; missing: string[]; total: number; }
export interface Job {
 id: string; mode: Mode; company: string; title: string; location: string; contract: string;
 url: string; publishedAt: string; description: string; easyApply: boolean;
 status: JobStatus; reason: string; match: Match | null; resumeId: string | null; updatedAt: string;
 processingDay?: string;
 comparisons?: {resumeId:string;name:string;score:number;language:string}[];
}
export interface Resume { id: string; mode: Mode; name: string; text: string; createdAt: string; parentId: string | null; jobId: string | null; highlights: string[]; source: 'original' | 'openai' | 'demo'; language?:string; needsReview?:boolean; sourceHighlights?:string[]; sample?:boolean; }
export interface Event { id: number; mode: Mode; runId: string | null; jobId: string | null; at: string; level: 'info' | 'success' | 'warning' | 'error'; action: string; message: string; }
export interface Run { id: string; mode: Mode; day: string; startedAt: string; finishedAt: string | null; status: 'running' | 'complete' | 'partial' | 'failed'; summary: string; }
export interface Settings { portalUrl: string; roles: string; locations: string; contract: string; timezone: string; dailyTime: string; scheduleEnabled: boolean; autoApply: boolean; model: string; }
export interface Snapshot { mode: Mode; day: string; jobs: Job[]; resumes: Resume[]; events: Event[]; runs: Run[]; settings: Settings; connection: { applicationsEnabled: boolean; session: boolean; apiKey: boolean; browser: boolean; portal: 'unverified' | 'verified' | 'failed'; portalMessage: string }; running: boolean; }
