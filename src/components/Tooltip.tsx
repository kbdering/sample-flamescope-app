import React, { useLayoutEffect, useRef, useState } from 'react';

interface TooltipProps {
    content: string;
    position: { x: number; y: number } | null;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, position }) => {
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<React.CSSProperties>({});

    useLayoutEffect(() => {
        if (position && tooltipRef.current) {
            const { x, y } = position;
            const { innerWidth, innerHeight } = window;
            const { offsetWidth, offsetHeight } = tooltipRef.current;

            let newStyle: React.CSSProperties = {
                position: 'fixed',
                zIndex: 1000,
                opacity: 1,
            };

            let transform = 'translate(-50%, -110%)'; // Default above

            if (y - offsetHeight < 0) { // overflows top
                transform = 'translate(-50%, 10%)'; // Move below
            }

            if (x + offsetWidth / 2 > innerWidth) { // overflows right
                transform = 'translate(-100%, -110%)';
            } else if (x - offsetWidth / 2 < 0) { // overflows left
                transform = 'translate(0%, -110%)';
            }

            newStyle.left = `${x}px`;
            newStyle.top = `${y}px`;
            newStyle.transform = transform;

            setStyle(newStyle);
        }
    }, [content, position]);

    if (!position) return null;

    return (
        <div ref={tooltipRef} className="tooltip" style={style}>
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
};