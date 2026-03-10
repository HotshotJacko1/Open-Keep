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

    const start = useCallback(
        (event: React.TouchEvent | React.MouseEvent) => {
            longPressTriggered.current = false;
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
    }, []);

    return {
        onMouseDown: (e: React.MouseEvent) => start(e),
        onTouchStart: (e: React.TouchEvent) => start(e),
        onMouseUp: (e: React.MouseEvent) => clear(),
        onMouseLeave: (e: React.MouseEvent) => clear(),
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
