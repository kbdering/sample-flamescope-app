import React, { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Tooltip } from './Tooltip';
import type { HeatmapData } from '../types';

interface HeatmapProps {
    data: HeatmapData;
    timeRange: { min: number, max: number } | null;
    onTimeRangeSelect: (range: { min: number, max: number } | null) => void;
}

export const Heatmap: React.FC<HeatmapProps> = ({ data, timeRange, onTimeRangeSelect }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [tooltip, setTooltip] = useState<{ content: string; position: { x: number; y: number } } | null>(null);
    
    const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
    const colorScaleRef = useRef<d3.ScaleSequential<string, never> | null>(null);
    const heatmapDataRef = useRef<HeatmapData['data'] | null>(null);

    const getCellId = (d: { second: number, interval: number }) => `${d.second}-${d.interval}`;

    const blendWithSelectionColor = (baseColorStr: string) => {
        const baseColor = d3.color(baseColorStr)?.rgb();
        if (!baseColor) return baseColorStr;
        const selectionColor = { r: 96, g: 165, b: 250 }; // from #60a5fa
        const alpha = 0.3; // Using a lower alpha for better visibility
        const r = baseColor.r * (1 - alpha) + selectionColor.r * alpha;
        const g = baseColor.g * (1 - alpha) + selectionColor.g * alpha;
        const b = baseColor.b * (1 - alpha) + selectionColor.b * alpha;
        return `rgb(${r}, ${g}, ${b})`;
    };

    // Effect for drawing the chart and setting up interactive listeners
    useEffect(() => {
        if (!data || !svgRef.current || !containerRef.current) return;

        heatmapDataRef.current = data.data;
        const { data: heatmapData, maxTime, maxCount } = data;

        const margin = { top: 20, right: 80, bottom: 40, left: 40 };
        const width = containerRef.current.offsetWidth - margin.left - margin.right;
        const height = containerRef.current.offsetHeight - margin.top - margin.bottom;

        const svg = d3.select(svgRef.current)
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom);

        svg.selectAll("*" ).remove();

        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        gRef.current = g;

        const xDomain = Array.from({ length: maxTime }, (_, i) => String(i));
        const x = d3.scaleBand<string>().range([0, width]).domain(xDomain).padding(0.05);

        const yDomain = Array.from({ length: 10 }, (_, i) => String(i));
        const y = d3.scaleBand<string>().range([height, 0]).domain(yDomain).padding(0.05);

        const color = d3.scaleSequential(d3.interpolateInferno).domain([1, Math.max(maxCount, 2)]);
        colorScaleRef.current = color;

        g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).tickValues(x.domain().filter((_, i) => i % 5 === 0))).append("text").attr("fill", "#fff").attr("x", width / 2).attr("y", 35).text("Time (seconds)");
        g.append("g").call(d3.axisLeft(y)).append("text").attr("fill", "#fff").attr("transform", "rotate(-90)").attr("y", -30).attr("x", -height / 2).attr("text-anchor", "middle").text("Time (100ms interval)");

        const legendWidth = 20, legendHeight = 200;
        const legend = svg.append("g").attr("transform", `translate(${width + margin.left + 20}, ${margin.top})`);
        const legendScale = d3.scaleLinear().domain(color.domain()).range([legendHeight, 0]);
        const linearGradient = legend.append("defs").append("linearGradient").attr("id", "gradient-color").attr("x1", "0%").attr("y1", "100%").attr("x2", "0%").attr("y2", "0%");
        linearGradient.selectAll("stop").data(legendScale.ticks().map((t, i, n) => ({ offset: `${100 * i / (n.length - 1)}%`, color: color(t) }))).enter().append("stop").attr("offset", d => d.offset).attr("stop-color", d => d.color);
        legend.append("rect").attr("width", legendWidth).attr("height", legendHeight).style("fill", "url(#gradient-color)");
        legend.append("g").call(d3.axisRight(legendScale).ticks(5)).attr("transform", `translate(${legendWidth}, 0)`);

        const selectedCells = new Set<string>();
        let isSelecting = false;
        let selectionAnchor: { second: number, interval: number } | null = null;

        const handleMouseUp = () => {
            if (!isSelecting) return;
            isSelecting = false;
            selectionAnchor = null;

            if (selectedCells.size === 0) {
                onTimeRangeSelect(null);
                return;
            }

            let minTime = Infinity;
            let maxTime = -Infinity;

            selectedCells.forEach(id => {
                const [secondStr, intervalStr] = id.split('-');
                const second = parseInt(secondStr);
                const interval = parseInt(intervalStr);
                const cellStartTime = second + interval * 0.1;
                const cellEndTime = cellStartTime + 0.1;

                if (cellStartTime < minTime) minTime = cellStartTime;
                if (cellEndTime > maxTime) maxTime = cellEndTime;
            });

            onTimeRangeSelect({ min: minTime, max: maxTime });
        };

        g.selectAll('.heatmap-rect')
            .data(heatmapData)
            .enter()
            .append("rect")
            .attr('class', 'heatmap-rect')
            .attr("x", d => x(String(d.second))!)
            .attr("y", d => y(String(d.interval))!)
            .attr("width", x.bandwidth())
            .attr("height", y.bandwidth())
            .style("fill", d => color(d.count))
            .on("mousedown", function(event, d) {
                event.preventDefault();
                isSelecting = true;
                selectionAnchor = { second: d.second, interval: d.interval };
                setTooltip(null);

                if (event.shiftKey) {
                    // Shift is an exclusive mode
                    g.selectAll('.heatmap-rect').style("fill", d => color((d as any).count));
                    selectedCells.clear();
                } else if (!event.ctrlKey && !event.metaKey) {
                    g.selectAll('.heatmap-rect').style("fill", d => color((d as any).count));
                    selectedCells.clear();
                }

                const id = getCellId(d);
                if (!selectedCells.has(id)) {
                    selectedCells.add(id);
                    d3.select(this).style('fill', blendWithSelectionColor(color(d.count)));
                }
            })
            .on("mouseover", function(event, d) {
                if (isSelecting) {
                    if (event.shiftKey && selectionAnchor) {
                        // This is an exclusive mode, so we clear and redraw the complex selection each time
                        if (!event.ctrlKey && !event.metaKey) {
                            g.selectAll('.heatmap-rect').style("fill", d => color((d as any).count));
                            selectedCells.clear();
                        }

                        const startCell = selectionAnchor;
                        const endCell = d;

                        const minCol = Math.min(startCell.second, endCell.second);
                        const maxCol = Math.max(startCell.second, endCell.second);

                        const requiredIds = new Set<string>();

                        for (let i = minCol; i <= maxCol; i++) {
                            let startInterval = 0;
                            let endInterval = 9;

                            if (i === startCell.second) {
                                startInterval = startCell.interval;
                            }
                            if (i === endCell.second) {
                                endInterval = endCell.interval;
                            }

                            if (startCell.second > endCell.second) {
                                if (i === startCell.second) endInterval = 9;
                                if (i === endCell.second) startInterval = 0;
                            } else {
                                if (i === startCell.second) endInterval = 9;
                                if (i === endCell.second) startInterval = 0;
                            }
                            
                            if (startCell.second === endCell.second) {
                                startInterval = Math.min(startCell.interval, endCell.interval)
                                endInterval = Math.max(startCell.interval, endCell.interval)
                            }

                            for (let j = startInterval; j <= endInterval; j++) {
                                requiredIds.add(getCellId({ second: i, interval: j }));
                            }
                        }
                        
                        g.selectAll('.heatmap-rect')
                            .filter(cd => requiredIds.has(getCellId(cd as any)))
                            .each(function(cd) {
                                const id = getCellId(cd as any);
                                if (!selectedCells.has(id)) {
                                    selectedCells.add(id);
                                    d3.select(this).style('fill', blendWithSelectionColor(color((cd as any).count)));
                                }
                            });

                    } else if (!event.shiftKey) {
                        const id = getCellId(d);
                        if (!selectedCells.has(id)) {
                            selectedCells.add(id);
                            d3.select(this).style('fill', blendWithSelectionColor(color(d.count)));
                        }
                    }
                } else {
                    const content = `<strong>Time:</strong> ${d.second}s ${d.interval * 100}ms<br><strong>Samples:</strong> ${d.count}`;
                    setTooltip({ content, position: { x: event.pageX, y: event.pageY - 10 } });
                }
            })
            .on("mouseout", () => {
                setTooltip(null);
            });

        svg.on('mouseup', handleMouseUp)
           .on('mouseleave', (event: MouseEvent) => {
               if (event.buttons !== 1) return;
               handleMouseUp();
           });

    }, [data, onTimeRangeSelect]);

    // Effect for keeping selection highlights in sync with parent state
    useEffect(() => {
        if (!gRef.current || !heatmapDataRef.current || !colorScaleRef.current) return;

        const color = colorScaleRef.current;
        const cellsToHighlight = new Set<string>();
        if (timeRange) {
            heatmapDataRef.current.forEach(d => {
                const cellStartTime = d.second + d.interval * 0.1;
                const cellEndTime = cellStartTime + 0.1;
                if (Math.max(cellStartTime, timeRange.min) < Math.min(cellEndTime, timeRange.max)) {
                    cellsToHighlight.add(getCellId(d));
                }
            });
        }

        gRef.current.selectAll('.heatmap-rect')
            .style('fill', function(d) {
                const baseColor = color((d as any).count);
                if (cellsToHighlight.has(getCellId(d as any))) {
                    return blendWithSelectionColor(baseColor);
                }
                return baseColor;
            });

    }, [timeRange]);

    const handleClearSelection = () => {
        onTimeRangeSelect(null);
    }

    return (
        <div ref={containerRef} className="w-full h-full overflow-auto relative" style={{ userSelect: 'none' }}>
            <button onClick={handleClearSelection} className="absolute top-2 right-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded text-sm z-10">
                Clear Selection
            </button>
            <svg ref={svgRef}></svg>
            {tooltip && <Tooltip content={tooltip.content} position={tooltip.position} />}
        </div>
    );
};
