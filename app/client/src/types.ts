export type Project = {
  id: string;
  name: string;
  status: string;
  aspectRatio?: string;
  templateId?: string;
  source?: string;
  segments: Segment[];
  script?: Script | null;
  visualBible?: VisualBible | null;
  renderPlan?: RenderPlan | null;
  storyboards?: Storyboard[];
  voiceover?: string;
  captions?: string;
  timings?: Array<{
    id: string;
    start: number;
    end: number;
    duration: number;
    text: string;
  }>;
  finalVideo?: string;
  videoSettings?: VideoSettings;
  segmentCount?: number;
  approvedSegmentCount?: number;
  updatedAt?: string;
};

export type VideoSettings = {
  captionsEnabled: boolean;
  captionPosition: "top" | "middle" | "bottom";
  bgmEnabled: boolean;
  playbackSpeed: number;
};

export type Segment = {
  id: string;
  index: number;
  text: string;
  ttsText?: string | null;
  visualDescription?: string;
  entities?: string[];
  status: string;
};

export type VisualBibleEntity = {
  id: string;
  name: string;
  role?: string;
  stableDescription?: string;
  doNotChange?: string[];
};

export type VisualBible = {
  characters: VisualBibleEntity[];
  objects: VisualBibleEntity[];
  places: VisualBibleEntity[];
  symbols: VisualBibleEntity[];
};

export type Script = {
  title: string;
  subtitle?: string;
};

export type RenderPlan = {
  duration: number;
  scenes: ScenePlan[];
};

export type ScenePlan = {
  id: string;
  type: string;
  index?: number;
  start: number;
  end: number;
  title?: string;
  subtitle?: string;
  summary?: string;
  visualDescription?: string;
  tag?: string;
  metric?: string;
  accent?: string;
  callout?: string;
  segmentIds?: string[];
  entities?: string[];
};

export type Storyboard = {
  id: string;
  sceneId: string;
  file: string;
  path: string;
  url?: string;
  title: string;
  prompt?: string;
  width: number;
  height: number;
  start: number;
  end: number;
  updatedAt: string;
};

export type VideoTemplate = {
  id: string;
  name: string;
  description: string;
  category?: string;
  aspectRatios?: string[];
  preview?: {
    kind?: string;
  } | null;
  imageStyle?: {
    background?: string;
    ink?: string;
    muted?: string;
    accent?: string;
    secondary?: string;
    surface?: string;
  };
};

export type Settings = {
  baseUrl: string;
  model: string;
  temperature: number;
  hasApiKey: boolean;
  hasMinimaxApiKey: boolean;
  scriptSystemPrompt: string;
  scriptUserPrompt: string;
  image: ImageSettings;
  audio: AudioSettings;
};

export type ImageSettings = {
  model: string;
  quality: string;
  outputFormat: string;
};

export type AudioSettings = {
  provider: string;
  minimaxApiKey: string;
  minimaxGroupId: string;
  minimaxBaseUrl: string;
  minimaxModel: string;
  minimaxVoiceId: string;
  minimaxSpeed: number;
  minimaxVolume: number;
  minimaxPitch: number;
  minimaxFormat: string;
  minimaxSampleRate: number;
  minimaxBitrate: number;
};

export type Job = {
  id: string;
  label: string;
  projectId?: string | null;
  type?: string;
  status: string;
  logs: string[];
  createdAt?: string;
  updatedAt?: string;
  meta?: {
    total?: number;
    generated?: number;
    failed?: number;
    currentSegment?: string | null;
    phase?: string;
  };
  error?: string | null;
};

export type StepId = "content" | "script" | "audio" | "visual" | "video";
export type View = { name: "home" } | { name: "project"; projectId: string };
