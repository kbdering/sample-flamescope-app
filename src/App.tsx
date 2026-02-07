import React from 'react';
import { FlameGraph } from './components/FlameGraph';
import { Heatmap } from './components/Heatmap';
import type { FlamegraphNode, HeatmapData } from './types';

type View = 'flamegraph' | 'heatmap';

function App() {
    const [originalData, setOriginalData] = React.useState<{ flamegraph: FlamegraphNode, heatmap: HeatmapData } | null>(null);
    const [filteredData, setFilteredData] = React.useState<{ flamegraph: FlamegraphNode, heatmap: HeatmapData } | null>(null);
    const [timeRange, setTimeRange] = React.useState<{ min: number, max: number } | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);
    const [view, setView] = React.useState<View>('flamegraph');
    const workerRef = React.useRef<Worker | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        workerRef.current = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });

        workerRef.current.onmessage = (e: MessageEvent<{ status: string, flamegraphData: FlamegraphNode, heatmapData: HeatmapData, message: string }>) => {
            setIsLoading(false);
            const { status, flamegraphData, heatmapData, message } = e.data;
            if (status === 'success') {
                // Iterative assignPaths to avoid stack overflow with deep trees
                const assignPathsStack: { node: FlamegraphNode; parentPath: string }[] = [{ node: flamegraphData, parentPath: '' }];
                while (assignPathsStack.length > 0) {
                    const { node, parentPath } = assignPathsStack.pop()!;
                    node._path = parentPath + '/' + node.name;
                    for (const child of (node.children || [])) {
                        assignPathsStack.push({ node: child, parentPath: node._path });
                    }
                }

                setOriginalData({ flamegraph: flamegraphData, heatmap: heatmapData });
                setError(null);
            } else {
                setError(message);
                setOriginalData(null);
                setFilteredData(null);
                console.error("Parsing error:", message);
            }
        };

        return () => {
            workerRef.current?.terminate();
        };
    }, []);

    // Iterative filterFlamegraph using post-order traversal to avoid stack overflow
    const filterFlamegraph = (rootNode: FlamegraphNode, minTime: number, maxTime: number): FlamegraphNode | null => {
        type StackEntry = { node: FlamegraphNode; phase: 'descend' | 'process'; filteredChildren?: FlamegraphNode[] };
        const stack: StackEntry[] = [{ node: rootNode, phase: 'descend' }];
        const resultMap = new Map<FlamegraphNode, FlamegraphNode | null>();

        while (stack.length > 0) {
            const entry = stack[stack.length - 1];

            if (entry.phase === 'descend') {
                entry.phase = 'process';
                // Push children onto stack first (they'll be processed before this node)
                for (const child of (entry.node.children || [])) {
                    stack.push({ node: child, phase: 'descend' });
                }
            } else {
                // Process phase - all children have been processed
                stack.pop();

                const filteredChildren = (entry.node.children || [])
                    .map(child => resultMap.get(child))
                    .filter(Boolean) as FlamegraphNode[];

                const samplesInNode = (entry.node.samples || []).filter(s => s.time >= minTime && s.time <= maxTime);
                const value = samplesInNode.length;

                if (value === 0 && filteredChildren.length === 0) {
                    resultMap.set(entry.node, null);
                    continue;
                }

                const totalCpuCostFromChildren = filteredChildren.reduce((sum, child) => sum + (child.totalCpuCost || 0), 0);
                const totalCpuCostFromNode = samplesInNode.reduce((sum, s) => sum + s.cpuCost, 0);
                const totalCpuCost = totalCpuCostFromChildren + totalCpuCostFromNode;

                const maxCpuCostFromChildren = Math.max(0, ...filteredChildren.map(child => child.maxCpuCost || 0));
                const maxCpuCostFromNode = Math.max(0, ...samplesInNode.map(s => s.cpuCost));
                const maxCpuCost = Math.max(maxCpuCostFromChildren, maxCpuCostFromNode);

                resultMap.set(entry.node, {
                    ...entry.node,
                    children: filteredChildren,
                    value: value,
                    samples: samplesInNode,
                    totalCpuCost: totalCpuCost,
                    maxCpuCost: maxCpuCost,
                });
            }
        }

        return resultMap.get(rootNode) ?? null;
    };

    React.useEffect(() => {
        if (!originalData) return;

        let graphData: FlamegraphNode = { name: 'root', value: 0, children: [] };

        if (timeRange) {
            const firstTime = originalData.heatmap.firstTime ?? 0;
            const min = firstTime + timeRange.min;
            const max = firstTime + timeRange.max;

            const filtered = filterFlamegraph(originalData.flamegraph, min, max);
            if (filtered) {
                graphData = filtered;
            }

        } else {
            const fullRangeMin = originalData.flamegraph.startTime || 0;
            const fullRangeMax = originalData.flamegraph.endTime || Infinity;
            const fullGraph = filterFlamegraph(originalData.flamegraph, fullRangeMin, fullRangeMax);
            if (fullGraph) {
                graphData = fullGraph;
            }
        }

        setFilteredData({ ...originalData, flamegraph: graphData });

    }, [timeRange, originalData]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setIsLoading(true);
            setError(null);
            setOriginalData(null);
            setFilteredData(null);
            setTimeRange(null);
            const reader = new FileReader();
            reader.onload = (e) => {
                workerRef.current?.postMessage({ fileContent: e.target?.result });
            };
            reader.readAsText(file);
        }
    };

    const handleDrop = (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove('border-indigo-400', 'bg-gray-800/50');
        const files = event.dataTransfer.files;
        if (files && files.length > 0 && fileInputRef.current) {
            fileInputRef.current.files = files;
            const changeEvent = new Event('change', { bubbles: true });
            fileInputRef.current.dispatchEvent(changeEvent);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); };
    const handleDragEnter = (e: React.DragEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('border-indigo-400', 'bg-gray-800/50'); };
    const handleDragLeave = (e: React.DragEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('border-indigo-400', 'bg-gray-800/50'); };

    const MainContent = () => {
        const [isGenerateHelpOpen, setIsGenerateHelpOpen] = React.useState(true);
        const [isProfilingHelpOpen, setIsProfilingHelpOpen] = React.useState(false);

        if (isLoading) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <svg className="animate-spin -ml-1 mr-3 h-10 w-10 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="mt-4 text-lg">Parsing perf data...</p>
                    <p className="text-sm">This may take a moment for large files.</p>
                </div>
            );
        }

        if (error) {
            return (
                <div className="flex items-center justify-center h-full text-red-400">
                    <div className="bg-red-900/50 border border-red-700 rounded-lg p-6 text-center">
                        <h3 className="text-xl font-semibold mb-2">Parsing Error</h3>
                        <p>{error}</p>
                    </div>
                </div>
            );
        }

        if (filteredData) {
            return (
                <div className="w-full h-full flex flex-col">
                    <div className="flex-shrink-0 p-2 bg-gray-800/50 rounded-md self-center mb-4">
                        <button onClick={() => setView('flamegraph')} className={`px-4 py-2 text-sm font-medium rounded-md ${view === 'flamegraph' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>Flame Graph</button>
                        <button onClick={() => setView('heatmap')} className={`px-4 py-2 text-sm font-medium rounded-md ${view === 'heatmap' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>Heatmap</button>
                    </div>
                    <div className="flex-grow w-full h-full overflow-hidden">
                        {view === 'flamegraph' ? <FlameGraph data={filteredData.flamegraph} /> : <Heatmap data={originalData!.heatmap} timeRange={timeRange} onTimeRangeSelect={setTimeRange} />}
                    </div>
                </div>
            );
        }

        // Default welcome screen
        return (
            <div className="w-full max-w-2xl text-center p-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-6 inline-block text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                <h2 className="text-2xl font-bold text-white mb-2">Welcome to the Perf Profiler</h2>
                <p className="text-gray-400">Select or drop a <code className="bg-gray-700 text-sm rounded px-1.5 py-0.5">.perf</code> file to begin.</p>
                <p className="mt-2 text-sm max-w-2xl mx-auto text-gray-500">All processing is done securely in your browser. Your data never leaves your machine.</p>

                <div className="mt-8 text-left w-full bg-gray-800/50 rounded-lg border border-gray-700">
                    <button
                        onClick={() => setIsGenerateHelpOpen(!isGenerateHelpOpen)}
                        className="w-full flex justify-between items-center p-6 text-lg font-semibold text-white text-center"
                    >
                        <h3>How to Generate a <code className="bg-gray-700 text-sm rounded px-1.5 py-0.5">.perf</code> file</h3>
                        <svg
                            className={`w-6 h-6 transform transition-transform duration-200 ${isGenerateHelpOpen ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </button>
                    {isGenerateHelpOpen && (
                        <div className="px-6 pb-6 space-y-4">
                            <div>
                                <p className="text-sm font-medium text-gray-300">1. Record performance data:</p>
                                <pre className="bg-black/40 border border-gray-600 text-cyan-300 text-sm p-3 rounded-md mt-1 overflow-x-auto"><code>perf record -F 99 -a -g -- sleep 30</code></pre>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-300">2. Convert to a text file:</p>
                                <pre className="bg-black/40 border border-gray-600 text-cyan-300 text-sm p-3 rounded-md mt-1 overflow-x-auto"><code>perf script &gt; my_profile.perf</code></pre>
                            </div>
                        </div>
                    )}
                </div>

                <div className="mt-8 text-left w-full bg-gray-800/50 rounded-lg border border-gray-700">
                    <button
                        onClick={() => setIsProfilingHelpOpen(!isProfilingHelpOpen)}
                        className="w-full flex justify-between items-center p-6 text-lg font-semibold text-white text-center"
                    >
                        <h3>Getting Better Stack Traces</h3>
                        <svg
                            className={`w-6 h-6 transform transition-transform duration-200 ${isProfilingHelpOpen ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </button>
                    {isProfilingHelpOpen && (
                        <div className="px-6 pb-6 space-y-4 text-sm">
                            <p className="text-gray-400">For interpreted or JIT-compiled languages, you may need to enable specific options to ensure frame pointers are preserved, which is essential for accurate stack traces.</p>
                            <div>
                                <p className="font-medium text-gray-300">Java / JVM:</p>
                                <pre className="bg-black/40 border border-gray-600 text-cyan-300 text-sm p-3 rounded-md mt-1 overflow-x-auto"><code>java -XX:+PreserveFramePointer ...</code></pre>
                            </div>
                            <div>
                                <p className="font-medium text-gray-300">Node.js:</p>
                                <pre className="bg-black/40 border border-gray-600 text-cyan-300 text-sm p-3 rounded-md mt-1 overflow-x-auto"><code>node --perf-basic-prof ...</code></pre>
                            </div>
                            <div>
                                <p className="font-medium text-gray-300">Python:</p>
                                <p className="text-gray-400 mt-1">Python profiling with <code className="bg-gray-700 text-sm rounded px-1.5 py-0.5">perf</code> can be complex. Consider using tools like <a href="https://github.com/benfred/py-spy" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">py-spy</a> which can generate compatible flamegraphs directly.</p>
                            </div>
                            <div>
                                <p className="font-medium text-gray-300">Go:</p>
                                <p className="text-gray-400 mt-1">Go programs usually provide good symbols by default. Build your application with <code className="bg-gray-700 text-sm rounded px-1.5 py-0.5">go build -toolexec="perf record"</code> or use the built-in pprof tool.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div id="app-container" className="h-full flex flex-col p-4 font-sans bg-gray-900 text-gray-100">
            <header className="flex-shrink-0 flex justify-between items-center pb-4 border-b border-gray-700">
                <h1 className="text-2xl font-bold">In-Browser Perf Profiler</h1>
                <div className="relative">
                    <input
                        type="file"
                        accept=".perf,.txt"
                        onChange={handleFileChange}
                        ref={fileInputRef}
                        className="hidden"
                        id="file-upload"
                    />
                    <label htmlFor="file-upload" className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                        {originalData ? 'Load New Perf File' : 'Select Perf File'}
                    </label>
                </div>
            </header>

            <main
                className="flex-grow flex flex-col items-center justify-center mt-4 border-2 border-dashed border-gray-600 rounded-lg transition-colors"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
            >
                <MainContent />
            </main>
        </div>
    );
}

export default App;
