import React, { useRef, useEffect } from 'react';

const urlRegex = /(https?:\/\/[^\s]+)/g;

export function renderTextWithLinks(text: string) {
    if (!text) return null;
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
        if (part.match(urlRegex)) {
            return (
                <a
                    key={i}
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline pointer-events-auto cursor-pointer text-inherit"
                    onClick={(e) => {
                        // Let it open
                    }}
                >
                    {part}
                </a>
            );
        }
        return <span key={i}>{part}</span>;
    });
}

interface LinkHighlightedTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    value: string;
}

export const LinkHighlightedTextarea = React.forwardRef<HTMLTextAreaElement, LinkHighlightedTextareaProps>(
    ({ value, className, onChange, placeholder, ...props }, ref) => {
        const localRef = useRef<HTMLTextAreaElement>(null);
        const textareaRef = (ref as React.MutableRefObject<HTMLTextAreaElement>) || localRef;

        const adjustHeight = () => {
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
            }
        };

        useEffect(() => {
            adjustHeight();
        }, [value]);

        // Extract base text color from className so we can apply it to the div
        const textColorMatch = className?.match(/text-\S+/g);
        // Exclude text-transparent if it's there
        const textColorClasses = textColorMatch ? textColorMatch.filter(c => c !== 'text-transparent').join(' ') : 'text-black dark:text-white';
        const baseClasses = className?.replace(/text-\S+/g, '').replace(/placeholder:\S+/g, '') || '';

        return (
            <div className="relative w-full h-full flex">
                <div
                    className={`${baseClasses} ${textColorClasses} absolute inset-0 pointer-events-none whitespace-pre-wrap break-words`}
                    aria-hidden="true"
                >
                    {!value && placeholder ? (
                        <span className="text-gray-400">{placeholder}</span>
                    ) : (
                        renderTextWithLinks(value)
                    )}
                    {/* Add a zero-width space at the end to ensure empty lines render properly */}
                    &#8203;
                </div>
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => {
                        if (onChange) onChange(e);
                        adjustHeight();
                    }}
                    placeholder=""
                    className={`${className} text-transparent caret-black dark:caret-white relative z-10 w-full h-full`}
                    {...props}
                />
            </div>
        );
    }
);

LinkHighlightedTextarea.displayName = 'LinkHighlightedTextarea';
