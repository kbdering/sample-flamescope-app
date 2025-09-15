import React from 'react';
import { FlameGraph } from './components/FlameGraph';
import { Heatmap } from './components/Heatmap';
import type { FlamegraphNode, HeatmapData } from './types';

type View = 'flamegraph' | 'heatmap';

function App() {
    const [data, setData] = React.useState<{ flamegraph: FlamegraphNode, heatmap: HeatmapData } | null>(null);
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
                setData({ flamegraph: flamegraphData, heatmap: heatmapData });
                setError(null);
            } else {
                setError(message);
                setData(null);
                console.error("Parsing error:", message);
            }
        };

        return () => {
            workerRef.current?.terminate();
        };
    }, []);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setIsLoading(true);
            setError(null);
            setData(null);
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

        if (data) {
             return (
                 <div className="w-full h-full flex flex-col">
                    <div className="flex-shrink-0 p-2 bg-gray-800/50 rounded-md self-center mb-4">
                        <button onClick={() => setView('flamegraph')} className={`px-4 py-2 text-sm font-medium rounded-md ${view === 'flamegraph' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>Flame Graph</button>
                        <button onClick={() => setView('heatmap')} className={`px-4 py-2 text-sm font-medium rounded-md ${view === 'heatmap' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>Heatmap</button>
                    </div>
                    <div className="flex-grow w-full h-full overflow-hidden">
                        {view === 'flamegraph' ? <FlameGraph data={data.flamegraph} /> : <Heatmap data={data.heatmap} />}
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

                <div className="mt-8 text-left w-full bg-gray-800/50 p-6 rounded-lg border border-gray-700">
                    <h3 className="font-semibold text-lg text-white mb-3 text-center">How to Generate a <code className="bg-gray-700 text-sm rounded px-1.5 py-0.5">.perf</code> file</h3>
                    <div className="space-y-4">
                        <div>
                            <p className="text-sm font-medium text-gray-300">1. Record performance data:</p>
                            <pre className="bg-black/40 border border-gray-600 text-cyan-300 text-sm p-3 rounded-md mt-1 overflow-x-auto"><code>perf record -F 99 -a -g -- sleep 30</code></pre>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-300">2. Convert to a text file:</p>
                            <pre className="bg-black/40 border border-gray-600 text-cyan-300 text-sm p-3 rounded-md mt-1 overflow-x-auto"><code>perf script &gt; my_profile.perf</code></pre>
                        </div>
                    </div>
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
                        {data ? 'Load New Perf File' : 'Select Perf File'}
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

