export interface FlamegraphNode {
  name: string;
  value: number;
  children: FlamegraphNode[];
  _collapsed?: boolean;
  _path?: string;
  _pruned?: boolean;
}

export interface HeatmapData {
  data: {
    second: number;
    interval: number;
    count: number;
  }[];
  maxTime: number;
  maxCount: number;
}

// A comment to force a reload