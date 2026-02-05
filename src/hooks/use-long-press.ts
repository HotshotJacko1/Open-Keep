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
    const [longPressTriggered, setLongPressTriggered] = useState(false);
    const timeout = useRef<NodeJS.Timeout>();
    const target = useRef<EventTarget>();

    const start = useCallback(
        (event: React.TouchEvent | React.MouseEvent) => {
            if (shouldPreventDefault && event.target) {
                target.current = event.target;
            }
            setLongPressTriggered(false);
            timeout.current = setTimeout(() => {
                onLongPress(event);
                setLongPressTriggered(true);
            }, delay);
        },
        [onLongPress, delay, shouldPreventDefault]
    );

    const clear = useCallback(
        (event: React.TouchEvent | React.MouseEvent, shouldTriggerClick = true) => {
            if (timeout.current) {
                clearTimeout(timeout.current);
            }
            if (shouldTriggerClick && !longPressTriggered) {
                onClick(event);
            }
            setLongPressTriggered(false);
            target.current = undefined;
        },
        [longPressTriggered, onClick]
    );

    return {
        onMouseDown: (e: React.MouseEvent) => start(e),
        onTouchStart: (e: React.TouchEvent) => start(e),
        onMouseUp: (e: React.MouseEvent) => clear(e),
        onMouseLeave: (e: React.MouseEvent) => clear(e, false),
        onTouchEnd: (e: React.TouchEvent) => clear(e),
    };
};

export default useLongPress;
