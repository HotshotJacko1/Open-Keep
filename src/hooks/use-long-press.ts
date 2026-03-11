import { useCallback, useRef, useState } from 'react';

interface UseLongPressOptions {
    shouldPreventDefault?: boolean;
    delay?: number;
}

const useLongPress = (
    onLongPress: (e: React.TouchEvent | React.MouseEvent) => void,
    onClick: (e: React.TouchEvent | React.MouseEvent) => void,
    { shouldPreventDefault = true, delay = 500 }: UseLongPressOptions = {}
) => {
    const longPressTriggered = useRef(false);
    const timeout = useRef<NodeJS.Timeout>();
    const startPosition = useRef<{ x: number, y: number } | null>(null);

    const start = useCallback(
        (event: React.TouchEvent | React.MouseEvent) => {
            longPressTriggered.current = false;
            
            const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
            const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
            startPosition.current = { x: clientX, y: clientY };

            timeout.current = setTimeout(() => {
                longPressTriggered.current = true;
                onLongPress(event);
            }, delay);
        },
        [onLongPress, delay]
    );

    const clear = useCallback(() => {
        if (timeout.current) {
            clearTimeout(timeout.current);
        }
        startPosition.current = null;
    }, []);

    const onMove = useCallback((event: React.TouchEvent | React.MouseEvent) => {
        if (!startPosition.current || longPressTriggered.current) return;
        
        const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
        const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
        
        const dx = clientX - startPosition.current.x;
        const dy = clientY - startPosition.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // If finger/mouse moves more than 10 pixels, cancel long press
        if (distance > 10) { 
            clear();
        }
    }, [clear]);

    return {
        onMouseDown: (e: React.MouseEvent) => start(e),
        onTouchStart: (e: React.TouchEvent) => start(e),
        onMouseMove: (e: React.MouseEvent) => onMove(e),
        onTouchMove: (e: React.TouchEvent) => onMove(e),
        onMouseUp: (e: React.MouseEvent) => clear(),
        onMouseLeave: (e: React.MouseEvent) => clear(),
        onTouchCancel: (e: React.TouchEvent) => clear(),
        onTouchEnd: (e: React.TouchEvent) => clear(),
        onClickCapture: (e: React.MouseEvent) => {
            if (longPressTriggered.current) {
                e.stopPropagation();
                e.preventDefault();
                longPressTriggered.current = false;
            } else {
                onClick(e);
            }
        }
    };
};

export default useLongPress;
