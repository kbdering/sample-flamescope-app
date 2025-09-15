import React, { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Tooltip } from './Tooltip';
import type { HeatmapData } from '../types';

interface HeatmapProps {
    data: HeatmapData;
}

export const Heatmap: React.FC<HeatmapProps> = ({ data }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [tooltip, setTooltip] = useState<{ content: string; position: { x: number; y: number } } | null>(null);

    useEffect(() => {
        if (!data || !svgRef.current || !containerRef.current) return;

        const { data: heatmapData, maxTime, maxCount } = data;

        const margin = { top: 20, right: 80, bottom: 40, left: 40 };
        const width = containerRef.current.offsetWidth - margin.left - margin.right;
        const height = containerRef.current.offsetHeight - margin.top - margin.bottom;

        const svg = d3.select(svgRef.current)
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom);

        svg.selectAll("*").remove();

        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        const xDomain = Array.from({ length: maxTime }, (_, i) => String(i));
        const x = d3.scaleBand()
            .range([0, width])
            .domain(xDomain)
            .padding(0.05);

        const yDomain = Array.from({ length: 10 }, (_, i) => String(i));
        const y = d3.scaleBand()
            .range([height, 0])
            .domain(yDomain)
            .padding(0.05);

        const color = d3.scaleSequential(d3.interpolateInferno)
            .domain([1, Math.max(maxCount, 2)]);

        g.append("g")
            .attr("transform", `translate(0,${height})`)
            .call(d3.axisBottom(x).tickValues(x.domain().filter((_, i) => i % 5 === 0)))
            .append("text")
            .attr("fill", "#fff")
            .attr("x", width / 2)
            .attr("y", 35)
            .text("Time (seconds)");

        g.append("g")
            .call(d3.axisLeft(y))
            .append("text")
            .attr("fill", "#fff")
            .attr("transform", "rotate(-90)")
            .attr("y", -30)
            .attr("x", -height / 2)
            .attr("text-anchor", "middle")
            .text("Time (100ms interval)");

        const handleMouseOver = (event: MouseEvent, d: { second: number, interval: number, count: number }) => {
            const content = `<strong>Time:</strong> ${d.second}s ${d.interval * 100}ms<br><strong>Samples:</strong> ${d.count}`;
            setTooltip({
                content,
                position: { x: event.pageX, y: event.pageY - 10 }
            });
        };

        const handleMouseOut = () => {
            setTooltip(null);
        };

        g.selectAll()
            .data(heatmapData)
            .enter()
            .append("rect")
            .attr("x", d => x(String(d.second))!)
            .attr("y", d => y(String(d.interval))!)
            .attr("width", x.bandwidth())
            .attr("height", y.bandwidth())
            .style("fill", d => color(d.count))
            .on("mouseover", (e, d) => handleMouseOver(e, d))
            .on("mouseout", handleMouseOut);

        const legendWidth = 20;
        const legendHeight = 200;
        const legend = svg.append("g")
            .attr("transform", `translate(${width + margin.left + 20}, ${margin.top})`);
        
        const legendScale = d3.scaleLinear()
            .domain(color.domain())
            .range([legendHeight, 0]);

        const linearGradient = legend.append("defs")
            .append("linearGradient")
            .attr("id", "gradient-color")
            .attr("x1", "0%").attr("y1", "100%").attr("x2", "0%").attr("y2", "0%");
        
        linearGradient.selectAll("stop")
            .data(legendScale.ticks().map((t, i, n) => ({ offset: `${100 * i / (n.length - 1)}%`, color: color(t) })))
            .enter().append("stop")
            .attr("offset", d => d.offset)
            .attr("stop-color", d => d.color);

        legend.append("rect")
            .attr("width", legendWidth)
            .attr("height", legendHeight)
            .style("fill", "url(#gradient-color)");

        legend.append("g")
            .call(d3.axisRight(legendScale).ticks(5))
            .attr("transform", `translate(${legendWidth}, 0)`);

    }, [data]);

    return (
        <div ref={containerRef} className="w-full h-full overflow-auto relative">
            <svg ref={svgRef}></svg>
            {tooltip && <Tooltip content={tooltip.content} position={tooltip.position} />}
        </div>
    );
};