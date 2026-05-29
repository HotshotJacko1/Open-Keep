// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useRef, useState, useEffect } from "react";
import { Bell, Clock, Calendar, X, RotateCcw } from "lucide-react";
import { getReminderOptions, ReminderOption } from "@/utils/reminder";
import { Note } from "@/types/note";
import { cn } from "@/lib/utils";

interface ReminderSheetProps {
  isOpen: boolean;
  onClose: () => void;
  currentReminder?: number;
  currentRecurrence?: Note['recurrence'];
  onSetReminder: (ts: number, recurrence?: Note['recurrence']) => void;
  onRemoveReminder: () => void;
}

const ReminderSheet: React.FC<ReminderSheetProps> = ({
  isOpen,
  onClose,
  currentReminder,
  currentRecurrence,
  onSetReminder,
  onRemoveReminder,
}) => {
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const [repeatType, setRepeatType] = useState<Note['recurrence'] | undefined>(currentRecurrence);
  
  // Local state for custom recurrence
  const [customInterval, setCustomInterval] = useState(repeatType?.interval || 1);
  const [customUnit, setCustomUnit] = useState<NonNullable<Note['recurrence']>['unit']>(repeatType?.unit || 'day');

  useEffect(() => {
    if (isOpen) {
      setRepeatType(currentRecurrence);
      if (currentRecurrence?.type === 'custom') {
        setCustomInterval(currentRecurrence.interval || 1);
        setCustomUnit(currentRecurrence.unit || 'day');
      }
    }
  }, [isOpen, currentRecurrence]);

  const options = getReminderOptions(new Date());

  const getActiveRecurrence = (): Note['recurrence'] | undefined => {
    if (!repeatType || repeatType.type === 'none') return undefined;
    if (repeatType.type === 'custom') {
      return { type: 'custom', interval: customInterval, unit: customUnit };
    }
    return repeatType;
  };

  const handleOptionClick = (option: ReminderOption) => {
    if (option.ts === null) {
      if (hiddenInputRef.current) {
        if ('showPicker' in HTMLInputElement.prototype) {
          hiddenInputRef.current.showPicker();
        } else {
          hiddenInputRef.current.click();
        }
      }
      return;
    }
    onSetReminder(option.ts, getActiveRecurrence());
    onClose();
  };

  const handleCustomDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const ts = new Date(val).getTime();
    if (!isNaN(ts)) {
      onSetReminder(ts, getActiveRecurrence());
      onClose();
    }
    e.target.value = "";
  };

  const handleRemove = () => {
    onRemoveReminder();
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-[100] bg-black/40 transition-opacity duration-300 reminder-sheet-backdrop",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Set reminder"
        className={cn(
          "fixed bottom-0 left-0 right-0 z-[110] bg-background dark:bg-[#202124] rounded-t-2xl shadow-2xl",
          "transition-all duration-300 ease-out",
          "pb-[env(safe-area-inset-bottom)]",
          isOpen ? "translate-y-0 opacity-100 pointer-events-auto" : "translate-y-full opacity-0 pointer-events-none"
        )}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        <div className="px-4 pb-4">
          {/* Header */}
          <div className="flex items-center justify-between py-3 border-b border-border mb-1">
            <span className="text-text-primary font-semibold flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Remind me
            </span>
            <button 
              onClick={onClose} 
              className="h-8 w-8 flex items-center justify-center hover:bg-muted dark:hover:bg-white/5 rounded-full transition-colors"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {/* Quick-pick options */}
          <ul className="divide-y divide-border">
            {options.map((option) => (
              <li key={option.label}>
                <button
                  id={`reminder-option-${option.label.toLowerCase().replace(/\s+/g, "-")}`}
                  className="w-full flex items-center gap-4 py-3.5 px-1 hover:bg-muted/50 dark:hover:bg-white/5 rounded-lg transition-colors text-left"
                  onClick={() => handleOptionClick(option)}
                >
                  {option.ts === null ? (
                    <Calendar className="h-5 w-5 text-muted-foreground shrink-0" />
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
                  )}
                  <span className="flex-1 text-sm font-medium text-text-primary">
                    {option.label}
                  </span>
                  {option.time && (
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {option.time}
                    </span>
                  )}
                </button>
              </li>
            ))}

            {/* Repeat Row */}
            <li className="py-2.5 px-1">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-4">
                  <RotateCcw className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-text-primary">Repeat</span>
                    <select
                      value={repeatType?.type || 'none'}
                      onChange={(e) => {
                        const val = e.target.value as Note['recurrence']['type'];
                        if (val === 'none') setRepeatType(undefined);
                        else setRepeatType({ type: val });
                      }}
                      className="bg-transparent text-sm text-muted-foreground focus:outline-none cursor-pointer text-right"
                    >
                      <option value="none">Does not repeat</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                      <option value="custom">Custom...</option>
                    </select>
                  </div>
                </div>

                {/* Custom Repeat Fields */}
                {repeatType?.type === 'custom' && (
                  <div className="ml-9 flex items-center gap-2 py-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    <span className="text-xs text-muted-foreground">Repeat every</span>
                    <input
                      type="number"
                      min="1"
                      value={customInterval}
                      onChange={(e) => setCustomInterval(parseInt(e.target.value) || 1)}
                      className="w-12 bg-muted/50 dark:bg-white/5 rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <select
                      value={customUnit}
                      onChange={(e) => setCustomUnit(e.target.value as any)}
                      className="bg-transparent text-xs text-muted-foreground focus:outline-none cursor-pointer"
                    >
                      <option value="day">day{customInterval !== 1 ? 's' : ''}</option>
                      <option value="week">week{customInterval !== 1 ? 's' : ''}</option>
                      <option value="month">month{customInterval !== 1 ? 's' : ''}</option>
                      <option value="year">year{customInterval !== 1 ? 's' : ''}</option>
                    </select>
                  </div>
                )}
              </div>
            </li>

            {/* Remove reminder row */}
            {currentReminder && (
              <li>
                <button
                  id="reminder-remove"
                  className="w-full flex items-center gap-4 py-3.5 px-1 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors text-left"
                  onClick={handleRemove}
                >
                  <X className="h-5 w-5 text-red-500 shrink-0" />
                  <span className="flex-1 text-sm font-medium text-red-500">
                    Remove reminder
                  </span>
                </button>
              </li>
            )}
          </ul>
        </div>

        {/* Hidden native picker input */}
        <input
          ref={hiddenInputRef}
          type="datetime-local"
          className="sr-only"
          onChange={handleCustomDateChange}
          min={new Date().toISOString().slice(0, 16)}
        />
      </div>
    </>
  );
};

export default ReminderSheet;
