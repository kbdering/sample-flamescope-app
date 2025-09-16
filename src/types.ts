export interface FlamegraphNode {
  name: string;
  value: number;
  children: FlamegraphNode[];
  process?: string;
  startTime?: number;
  endTime?: number;
  samples?: { time: number, cpuCost: number }[];
  maxCpuCost?: number;
  totalCpuCost?: number;
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
  firstTime?: number;
}

// A comment to force a reload