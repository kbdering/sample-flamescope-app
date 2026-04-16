import type { FlamegraphNode, HeatmapData } from './types';

// This file runs in a separate thread and handles heavy parsing.

function parsePerfScript(text: string) {
    const lines = text.split('\n');
    const samples: { stack: string[], time: number, process: string, cpuCost: number }[] = [];
    let currentSample: { stack: string[], time: number, process: string, cpuCost: number } | null = null;
    let foundSampleHeader = false;
    const lastCpuCostByCpu = new Map<number, number>();

    for (const line of lines) {
        if (!line.trim()) continue;

        // Match sample header: command PID [CPU] TIMESTAMP: COST EVENT:
        // Example: perf 1764993 [000] 259339.479440:          1 cycles:P:
        const headerMatch = line.match(/^(\S+)\s+(\d+)\s+\[(\d+)\]\s+([\d.]+):\s+(\d+)\s+(\S+):/);
        
        if (headerMatch) {
            if (currentSample) {
                samples.push(currentSample);
            }
            foundSampleHeader = true;
            
            const processName = headerMatch[1];
            const time = parseFloat(headerMatch[4]);
            const cpuCost = parseInt(headerMatch[5]);

            currentSample = { 
                stack: [], 
                time: time, 
                process: processName, 
                cpuCost: cpuCost 
            };
        } else if (currentSample && (line.startsWith('\t') || line.startsWith(' '))) {
            const trimmed = line.trim();
            const parts = trimmed.split(/\s+/);
            
            let frameName = '';
            let moduleName = '';
            
            if (parts.length >= 2) {
                // Determine if first part is an address
                if (/^[0-9a-fA-F]+$/.test(parts[0])) {
                    frameName = parts[1];
                    moduleName = parts[2] || '';
                } else {
                    frameName = parts[0];
                    moduleName = parts[1] || '';
                }
            } else {
                frameName = parts[0];
            }
            
            if (frameName) {
                let cleanFrame = frameName.split('+')[0];
                if (cleanFrame === '[unknown]' && moduleName) {
                    // Use module name for context if symbol is unknown
                    const cleanMod = moduleName.replace(/[()]/g, '');
                    cleanFrame = `[unknown] (${cleanMod})`;
                }
                
                if (cleanFrame.startsWith('L')) {
                    cleanFrame = cleanFrame.substring(1).replace(/;/g, '.');
                }
                
                // Aggregate consecutive identical frames (common with [unknown] stacks)
                // This allows better aggregation of unresolved contexts in the flamegraph.
                if (currentSample.stack.length === 0 || currentSample.stack[0] !== cleanFrame) {
                    currentSample.stack.unshift(cleanFrame);
                }
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

        if (sample.stack.length === 0) {
            root.value++;
            root.samples = root.samples || [];
            root.samples.push({ time: sample.time, cpuCost: sample.cpuCost });
            continue;
        }

        for (let i = 0; i < sample.stack.length; i++) {
            let frameName = sample.stack[i];
            let processName = sample.process;

            if (frameName.includes('[unknown]')) {
                // Keep the original name with module context
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

// Flatten tree to avoid stack overflow during postMessage serialization
function flattenFlamegraph(root: FlamegraphNode): any[] {
    const flat: any[] = [];
    const stack: { node: FlamegraphNode; parentId: number | null }[] = [{ node: root, parentId: null }];
    let nextId = 0;

    while (stack.length > 0) {
        const { node, parentId } = stack.pop()!;
        const id = nextId++;
        
        // Extract node data without children
        const { children, ...nodeData } = node;
        flat.push({ ...nodeData, id, parentId });

        // Push children to stack
        if (children) {
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push({ node: children[i], parentId: id });
            }
        }
    }
    return flat;
}

self.onmessage = (e: MessageEvent<{ fileContent: string }>) => {
    const { fileContent } = e.data;
    try {
        const samples = parsePerfScript(fileContent);
        const flamegraphData = buildFlamegraphData(samples);
        const heatmapData = buildHeatmapData(samples as any);
        
        // Flatten the tree to avoid stack overflow in postMessage structured clone
        const flatFlamegraph = flattenFlamegraph(flamegraphData);
        
        self.postMessage({ status: 'success', flatFlamegraph, heatmapData });
    } catch (error) {
        self.postMessage({ status: 'error', message: (error as Error).message });
    }
};

// Export {} to make it a module.
export { };
