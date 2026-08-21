import React, { useRef, useEffect } from 'react';

const urlRegex = /(https?:\/\/[^\s]+)/g;

function renderTextWithLinks(text: string) {
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

        // Both layers receive the full className so variant-prefixed utilities
        // (e.g. dark:text-white) stay intact. The real textarea's glyphs are made
        // transparent via inline style, which reliably beats any text-* utility
        // regardless of Tailwind's stylesheet ordering. The wrapper stays
        // auto-sized so it never stretches to fill definite-height ancestors.
        return (
            <div className="relative w-full flex">
                <div
                    className={`${className ?? ''} absolute inset-0 pointer-events-none whitespace-pre-wrap break-words z-20`}
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
                    className={`${className ?? ''} caret-black dark:caret-white relative z-10 w-full`}
                    {...props}
                    style={{
                        color: 'transparent',
                        WebkitTextFillColor: 'transparent',
                        ...props.style,
                    }}
                />
            </div>
        );
    }
);

LinkHighlightedTextarea.displayName = 'LinkHighlightedTextarea';
