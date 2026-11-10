export interface PresetVideo {
  id: string;
  title: string;
  duration: string;
  description: string;
  tag: string;
  thumbnailColor: string;
  videoUrl?: string;
}

export type GenerationStep = 'idle' | 'detecting_face' | 'swapping_frames' | 'encoding' | 'done' | 'error';

export interface GenerateState {
  step: GenerationStep;
  progress: number;
  statusMessage: string;
  resultVideoUrl: string | null;
  resultVideoBlob: Blob | null;
  error: string | null;
}

