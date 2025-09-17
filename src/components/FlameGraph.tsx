import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import { Tooltip } from './Tooltip';
import type { FlamegraphNode } from '../types';

type FlamegraphHierarchyNode = d3.HierarchyRectangularNode<FlamegraphNode>;

interface FlameGraphProps {
    data: FlamegraphNode;
}

export const FlameGraph: React.FC<FlameGraphProps> = ({ data }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [tooltip, setTooltip] = useState<{ content: string; position: { x: number; y: number } } | null>(null);
    const tooltipTimer = useRef<number | null>(null);
    const truncatedNames = useRef(new Map<FlamegraphNode, string>());
    const [generation, setGeneration] = useState(0);
    const rootRef = useRef<FlamegraphHierarchyNode | null>(null);
    const [collapsedNodes, setCollapsedNodes] = useState<Map<string, boolean>>(new Map());
    const [prunedNodes, setPrunedNodes] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FlamegraphHierarchyNode } | null>(null);
    const [colorByCpuCost, setColorByCpuCost] = useState(false);
    const [zoomTarget, setZoomTarget] = useState<FlamegraphHierarchyNode | null>(null);

    const colorScale = d3.scaleOrdinal(d3.schemePaired);

    const handleMouseOver = useCallback((event: MouseEvent, d: d3.HierarchyRectangularNode<FlamegraphNode>) => {
        if (tooltipTimer.current) {
            clearTimeout(tooltipTimer.current);
        }

        const descendantCount = d.descendants().length - 1;
        const stackSize = d.depth;
        const processInfo = d.data.process ? `<br>Process: ${d.data.process}` : '';
        const maxCpu = d.data.maxCpuCost ? `<br>Max CPU: ${d.data.maxCpuCost.toLocaleString()}` : '';
        const avgCpu = d.data.totalCpuCost && d.data.value > 0 ? `<br>Avg CPU: ${(d.data.totalCpuCost / d.data.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';

        const fullContent = `<strong>${d.data.name}</strong><br>${d.value.toLocaleString()} samples${processInfo}<br>Descendants: ${descendantCount}<br>Stack Size: ${stackSize}${maxCpu}${avgCpu}`;

        setTooltip({
            content: fullContent,
            position: { x: event.pageX, y: event.pageY - 10 }
        });

        tooltipTimer.current = window.setTimeout(() => {
            const shortContent = `<strong>${d.data.name}</strong><br>${d.data.value.toLocaleString()} samples${processInfo}`;
            setTooltip(prev => prev ? { ...prev, content: shortContent } : null);
        }, 1000);
    }, []);

    const handleMouseOut = () => {
        if (tooltipTimer.current) {
            clearTimeout(tooltipTimer.current);
        }
        setTooltip(null);
    };

    const handleClick = (event: React.MouseEvent, d: FlamegraphHierarchyNode) => {
        event.stopPropagation();
        setZoomTarget(d);
    };

    const handleContextMenu = (event: React.MouseEvent, d: FlamegraphHierarchyNode) => {
        event.preventDefault();
        if (!containerRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const x = event.pageX - containerRect.left;
        const y = event.pageY - containerRect.top;
        setContextMenu({ x, y, node: d });
    };

    const handleClearPruned = () => {
        setPrunedNodes(new Set());
        setGeneration(g => g + 1);
    };

    const handlePruneNode = () => {
        if (contextMenu) {
            setPrunedNodes(prev => {
                const newSet = new Set(prev);
                contextMenu.node.each(node => {
                    if (node.data._path) newSet.add(node.data._path);
                });
                return newSet;
            });
            setContextMenu(null);
            setGeneration(g => g + 1);
        }
    };

    const handleToggleCollapse = () => {
        if (contextMenu) {
            const { node } = contextMenu;
            setCollapsedNodes(prev => {
                const newMap = new Map(prev);
                const currentState = newMap.get(node.data.name) || false;
                newMap.set(node.data.name, !currentState);
                return newMap;
            });
            setContextMenu(null);
            setGeneration(g => g + 1);
        }
    };

    useEffect(() => {
        if (data) {
            rootRef.current = d3.hierarchy(data, d => d.children?.filter(c => c && typeof c === 'object' && 'name' in c && 'value' in c && 'children' in c)) as FlamegraphHierarchyNode;
            rootRef.current.sum(d => d.value ?? 0);
            rootRef.current.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
            rootRef.current.each((node: FlamegraphHierarchyNode) => {
                if (node.data) node.data._path = (node.parent ? node.parent.data._path + '/' : '') + node.data.name;
            });
        }
    }, [data]);

    useEffect(() => {
        if (!rootRef.current || !svgRef.current || !containerRef.current) return;

        const width = containerRef.current.offsetWidth;
        const height = containerRef.current.offsetHeight;
        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg.attr('viewBox', [0, 0, width, height].join(' '));

        const root = rootRef.current.copy();
        root.each(node => {
            if (node.data) {
                node.data._collapsed = collapsedNodes.get(node.data.name) ?? false;
                if (node.data._path) node.data._pruned = prunedNodes.has(node.data._path);
            }
        });
        root.each(node => { if (node.data?._pruned) node.each(d => { if (d.data) d.data._pruned = true; }); });
        root.eachAfter(node => {
            let sum = (node.data && !node.data._pruned) ? (node.data.value ?? 0) : 0;
            if (node.children) sum += node.children.reduce((acc, child) => acc + child.value, 0);
            node.value = sum;
        });

        const partition = d3.partition<FlamegraphNode>().size([width, height]).padding(1);
        partition(root);

        let z = root;
        if (zoomTarget && zoomTarget.data._path) {
            root.each(n => { if (n.data._path === zoomTarget.data._path) z = n; });
        }

        const visibleNodes = root.descendants().filter(d => {
            if (d.value <= 0 || d.data._pruned) return false;
            let current = d.parent;
            while (current) {
                if (current.data._collapsed) return false;
                current = current.parent;
            }
            return d.x1 > z.x0 && d.x0 < z.x1;
        });

        const max_y1 = d3.max(visibleNodes, d => d.y1) ?? height;
        const xScale = d3.scaleLinear().domain([z.x0, z.x1]).range([0, width]);
        const yScale = d3.scaleLinear().domain([z.y0, max_y1]).range([0, height]);
        const maxCpuCost = d3.max(visibleNodes, d => d.data.maxCpuCost) || 0;
        const cpuColorScale = d3.scaleSequential(d3.interpolateReds).domain([0, maxCpuCost]);

        const cell = svg.selectAll("g").data(visibleNodes).join("g").attr("transform", d => `translate(${xScale(d.x0)},${height - yScale(d.y1)})`);

        cell.append("rect")
            .attr("width", d => xScale(d.x1) - xScale(d.x0))
            .attr("height", d => Math.max(0, yScale(d.y1) - yScale(d.y0)))
            .attr("fill", d => d.data._collapsed ? '#aaa' : colorByCpuCost ? cpuColorScale(d.data.maxCpuCost || 0) : colorScale(d.data.name))
            .attr("class", "flamegraph-rect")
            .on("mouseover", (e, d) => handleMouseOver(e, d as FlamegraphHierarchyNode))
            .on("mouseout", handleMouseOut)
            .on("click", (e, d) => handleClick(e, d as FlamegraphHierarchyNode))
            .on("contextmenu", (e, d) => handleContextMenu(e, d as FlamegraphHierarchyNode));

        cell.filter(d => d.data._collapsed).append('text').attr('x', d => (xScale(d.x1) - xScale(d.x0)) / 2).attr('y', d => (yScale(d.y1) - yScale(d.y0)) / 2).attr('dy', '0.35em').attr('text-anchor', 'middle').style('font-size', '16px').style('font-weight', 'bold').style('pointer-events', 'none').attr('fill', 'white').text('+');

        cell.append("text").attr("x", 4).attr("y", d => Math.max(0, yScale(d.y1) - yScale(d.y0)) - 4).attr("fill", "white").style("font-size", "12px").style("pointer-events", "none").each(function(d) {
            const node = d3.select(this);
            const rectWidth = xScale(d.x1) - xScale(d.x0);
            if (rectWidth < 20) { node.text(""); return; }
            const tempText = svg.append("text").attr("font-size", "12px").text(d.data.name);
            const textNode = tempText.node();
            if (!textNode) { node.text(d.data.name); tempText.remove(); return; }
            const textLength = textNode.getComputedTextLength();
            let text = d.data.name;
            if (textLength > rectWidth - 8) {
                const avgCharWidth = textLength / text.length;
                const maxChars = Math.floor((rectWidth - 8) / avgCharWidth);
                text = maxChars > 3 ? text.substring(0, maxChars - 3) + "..." : "";
            }
            node.text(text);
            truncatedNames.current.set(d.data, text);
            tempText.remove();
        });

    }, [generation, colorScale, handleMouseOver, collapsedNodes, prunedNodes, colorByCpuCost, zoomTarget]);

    return (
        <div className="w-full h-full flex flex-col">
            <div className="w-full h-8 bg-gray-900 text-white flex items-center px-2 text-sm flex-shrink-0">
                <span className="font-bold">Path:</span>
                <a href="#" className="px-2 hover:underline" onClick={(e) => { e.preventDefault(); setZoomTarget(null); }}>Root</a>
                {zoomTarget && zoomTarget.ancestors().reverse().slice(1).map(ancestor => (
                    <span key={ancestor.data._path}>
                        {' > '}
                        <a href="#" className="px-2 hover:underline" onClick={(e) => { e.preventDefault(); setZoomTarget(ancestor); }}>
                            {ancestor.data.name}
                        </a>
                    </span>
                ))}
                {zoomTarget && <span className="font-bold text-yellow-400">{' > '}{zoomTarget.data.name}</span>}
            </div>
            <div ref={containerRef} className="w-full h-full relative flex-grow">
                <div className="absolute top-2 right-2 flex items-center space-x-2 z-10">
                    <label className="flex items-center space-x-1 text-white text-sm">
                        <input type="checkbox" checked={colorByCpuCost} onChange={() => setColorByCpuCost(!colorByCpuCost)} className="form-checkbox h-4 w-4 text-indigo-600 bg-gray-800 border-gray-600 rounded focus:ring-indigo-500" />
                        <span>Color by CPU Cost</span>
                    </label>
                    <button onClick={() => setCollapsedNodes(new Map())} className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded text-sm">Expand All</button>
                    <button onClick={handleClearPruned} className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-sm">Clear Pruned</button>
                </div>
                <svg ref={svgRef} width="100%" height="100%"></svg>
                {tooltip && <Tooltip content={tooltip.content} position={tooltip.position} />}
                {contextMenu && (
                    <div
                        className="absolute bg-purple-500 border-4 border-yellow-400 shadow-lg rounded py-1 z-[9999] w-48"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                        onMouseLeave={() => setContextMenu(null)}
                    >
                        <button onClick={handlePruneNode} className="block w-full text-left px-4 py-2 text-sm text-white hover:bg-purple-600">Prune Node</button>
                        <button onClick={handleToggleCollapse} className="block w-full text-left px-4 py-2 text-sm text-white hover:bg-purple-600">
                            {collapsedNodes.get(contextMenu.node.data.name) ? 'Expand Node' : 'Collapse Node'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};