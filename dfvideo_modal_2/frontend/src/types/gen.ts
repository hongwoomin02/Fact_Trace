export type JobStatus = 'queued' | 'processing' | 'done' | 'error';

export type GenErrorCode = 'FACE_NOT_FOUND' | 'MULTIPLE_FACES' | 'SERVER_BUSY' | 'INTERNAL' | 'TIMEOUT' | 'UNKNOWN';

export interface TemplateVideo {
  id: string;
  title: string;
  duration_sec: number;
  thumbnail_url: string;
  preview_url: string;
  description?: string;
}

export interface JobCreateResponse {
  job_id: string;
}

export interface JobStatusResponse {
  simulated?: boolean;
  status: JobStatus;
  progress?: number;
  error_code?: GenErrorCode | string;
  message?: string;
  result_url?: string;
}
