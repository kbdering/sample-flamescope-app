import type { FlamegraphNode, HeatmapData } from './types';

// This file runs in a separate thread and handles heavy parsing.

function parsePerfScript(text: string) {
    const lines = text.split('\n');
    const samples: { stack: string[], time: number, process: string, cpuCost: number }[] = [];
    let currentSample: { stack: string[], time: number, process: string, cpuCost: number } | null = null;
    let foundSampleHeader = false;
    const lastCpuCostByCpu = new Map<number, number>();

    for (const line of lines) {
        const match = line.match(/^(\S+)\s+(\d+)\s+\[(\d+)\]\s+([\d.]+):/);
        if (match) {
            foundSampleHeader = true;
            if (currentSample) {
                samples.push(currentSample);
            }
            const processName = match[1];
            const cumulativeCpuCost = parseInt(match[2]);
            const cpu = parseInt(match[3]);
            const lastCpuCost = lastCpuCostByCpu.get(cpu) || 0;
            const intervalCpuCost = cumulativeCpuCost - lastCpuCost;
            lastCpuCostByCpu.set(cpu, cumulativeCpuCost);

            currentSample = { stack: [], time: parseFloat(match[4]), process: processName, cpuCost: Math.max(0, intervalCpuCost) };
        } else if (currentSample && line.trim()) {
            const frame = line.trim().split(' ')[1];
            if (frame) {
                let cleanFrame = frame.split('+')[0];
                if (cleanFrame.startsWith('L')) {
                    cleanFrame = cleanFrame.substring(1).replace(/;/g, '.');
                }
                currentSample.stack.unshift(cleanFrame);
            }
        }
    }
    if (currentSample) {
        samples.push(currentSample);
    }

    if (!foundSampleHeader) {
        throw new Error("Invalid file format: No sample headers found. Perf script output should contain lines with timestamps (e.g., 'command 1234 123.456:').");
    }

    if (samples.length === 0) {
        throw new Error("No complete samples could be parsed. Check that the file is not empty or truncated.");
    }

    return samples;
}

function buildFlamegraphData(samples: { stack: string[], time: number, process: string, cpuCost: number }[]): FlamegraphNode {
    const root: FlamegraphNode = { name: 'root', value: 0, children: [], samples: [] };
    if (samples.length > 0) {
        root.startTime = samples[0].time;
        root.endTime = samples[samples.length - 1].time;
    }

    for (const sample of samples) {
        let currentNode: FlamegraphNode = root;

        for (let i = 0; i < sample.stack.length; i++) {
            let frameName = sample.stack[i];
            let processName = sample.process;

            if (frameName === '[unknown]') {
                let unknownCount = 1;
                while (i + 1 < sample.stack.length && sample.stack[i + 1] === '[unknown]') {
                    unknownCount++;
                    i++;
                }

                if (unknownCount > 1) {
                    frameName = `${unknownCount} x [unknown] (${processName})`
                } else {
                    frameName = `[unknown] (${processName})`
                }
            }

            let childNode = currentNode.children.find((c) => c.name === frameName);

            if (!childNode) {
                childNode = {
                    name: frameName,
                    value: 0,
                    children: [],
                    process: processName,
                    startTime: sample.time,
                    endTime: sample.time,
                    samples: []
                };
                currentNode.children.push(childNode);
            } else {
                if (childNode.startTime && childNode.startTime > sample.time) {
                    childNode.startTime = sample.time;
                }
                if (childNode.endTime && childNode.endTime < sample.time) {
                    childNode.endTime = sample.time;
                }
            }

            if (i === sample.stack.length - 1) {
                childNode.value++;
                childNode.samples = childNode.samples || [];
                childNode.samples.push({ time: sample.time, cpuCost: sample.cpuCost });
            }

            currentNode = childNode;
        }
    }

    // Iterative post-order traversal to avoid stack overflow with deep trees
    function resetParentValuesAndPropagateTimes(rootNode: FlamegraphNode) {
        type StackEntry = { node: FlamegraphNode; phase: 'descend' | 'process' };
        const stack: StackEntry[] = [{ node: rootNode, phase: 'descend' }];

        while (stack.length > 0) {
            const entry = stack[stack.length - 1];

            if (entry.phase === 'descend') {
                entry.phase = 'process';
                // Push children onto stack (they'll be processed before this node)
                for (const child of entry.node.children) {
                    stack.push({ node: child, phase: 'descend' });
                }
            } else {
                // Process phase - all children have been processed
                stack.pop();

                if (entry.node.children.length > 0) {
                    entry.node.value = 0;
                    let minStartTime = Infinity;
                    let maxEndTime = -Infinity;
                    for (const child of entry.node.children) {
                        if (child.startTime && child.startTime < minStartTime) minStartTime = child.startTime;
                        if (child.endTime && child.endTime > maxEndTime) maxEndTime = child.endTime;
                    }
                    entry.node.startTime = minStartTime;
                    entry.node.endTime = maxEndTime;
                }
            }
        }
    }

    resetParentValuesAndPropagateTimes(root);
    root.value = 0; // Root value will be summed up by d3

    return root;
}

function buildHeatmapData(samples: { stack: string[], time: number, process: string }[]): HeatmapData {
    if (samples.length === 0) {
        return { data: [], maxTime: 0, maxCount: 0 };
    }

    const firstTime = samples[0].time;
    const maxTime = samples[samples.length - 1].time - firstTime;

    const numSeconds = Math.ceil(maxTime);
    const buckets: number[][] = Array.from({ length: numSeconds }, () => Array(10).fill(0));
    let maxCount = 0;

    for (const sample of samples) {
        const relativeTime = sample.time - firstTime;
        const second = Math.floor(relativeTime);
        const interval = Math.floor((relativeTime - second) * 10);

        if (second < numSeconds && interval < 10) {
            buckets[second][interval]++;
            if (buckets[second][interval] > maxCount) {
                maxCount = buckets[second][interval];
            }
        }
    }

    const heatmapData: { second: number, interval: number, count: number }[] = [];
    for (let i = 0; i < numSeconds; i++) {
        for (let j = 0; j < 10; j++) {
            if (buckets[i][j] > 0) {
                heatmapData.push({ second: i, interval: j, count: buckets[i][j] });
            }
        }
    }

    return { data: heatmapData, maxTime: numSeconds, maxCount, firstTime };
}

self.onmessage = (e: MessageEvent<{ fileContent: string }>) => {
    const { fileContent } = e.data;
    try {
        const samples = parsePerfScript(fileContent);
        const flamegraphData = buildFlamegraphData(samples);
        const heatmapData = buildHeatmapData(samples as any);
        self.postMessage({ status: 'success', flamegraphData, heatmapData });
    } catch (error) {
        // Log the full error for debugging, but only send the message to the main thread
        console.error("Error parsing perf script:", error);
        self.postMessage({ status: 'error', message: (error as Error).message });
    }
};

// Export {} to make it a module.
export { };
