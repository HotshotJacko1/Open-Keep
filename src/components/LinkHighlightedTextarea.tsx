import React, { useRef, useEffect } from 'react';

const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const trailingPunctuationRegex = /[.,;:!?)\]}'"]+$/;

function renderTextWithLinks(text: string) {
    if (!text) return null;
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    urlRegex.lastIndex = 0;
    while ((match = urlRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            elements.push(
                <span key={`text-${lastIndex}`}>{text.substring(lastIndex, match.index)}</span>
            );
        }

        let rawUrl = match[0];
        const punctMatch = rawUrl.match(trailingPunctuationRegex);
        let punctuation = "";
        if (punctMatch) {
            punctuation = punctMatch[0];
            rawUrl = rawUrl.slice(0, -punctuation.length);
        }

        const href = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawUrl)
            ? rawUrl
            : `https://${rawUrl}`;

        elements.push(
            <a
                key={`link-${match.index}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline pointer-events-auto cursor-pointer text-inherit"
            >
                {rawUrl}
            </a>
        );

        if (punctuation) {
            elements.push(
                <span key={`punct-${match.index + rawUrl.length}`}>{punctuation}</span>
            );
        }

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        elements.push(
            <span key={`text-${lastIndex}`}>{text.substring(lastIndex)}</span>
        );
    }

    return elements;
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
