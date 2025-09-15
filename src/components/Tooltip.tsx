import React from 'react';

interface TooltipProps {
    content: string;
    position: { x: number; y: number } | null;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, position }) => {
    if (!position) return null;

    return (
        <div
            className="tooltip"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                position: 'fixed',
                zIndex: 1000,
                opacity: 1,
                transform: 'translate(-50%, -110%)' // Adjusted for better placement
            }}
        >
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
};