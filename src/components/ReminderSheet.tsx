import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Clock, Calendar, X } from "lucide-react";
import { getReminderOptions, ReminderOption } from "@/utils/reminder";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ReminderSheetProps {
  isOpen: boolean;
  onClose: () => void;
  currentReminder?: number;
  onSetReminder: (ts: number) => void;
  onRemoveReminder: () => void;
}

const ReminderSheet: React.FC<ReminderSheetProps> = ({
  isOpen,
  onClose,
  currentReminder,
  onSetReminder,
  onRemoveReminder,
}) => {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customDateTime, setCustomDateTime] = useState("");

  const options = getReminderOptions(new Date());

  const handleOptionClick = (option: ReminderOption) => {
    if (option.ts === null) {
      // "Choose a date and time"
      setShowDatePicker(true);
      return;
    }
    onSetReminder(option.ts);
    onClose();
  };

  const handleCustomDateConfirm = () => {
    if (!customDateTime) return;
    const ts = new Date(customDateTime).getTime();
    if (isNaN(ts)) return;
    onSetReminder(ts);
    setShowDatePicker(false);
    onClose();
  };

  const handleRemove = () => {
    onRemoveReminder();
    onClose();
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-[100] bg-black/40 transition-opacity duration-300",
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
          "transition-transform duration-300 ease-out",
          "pb-[env(safe-area-inset-bottom)]",
          isOpen ? "translate-y-0" : "translate-y-full"
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
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {showDatePicker ? (
            /* Custom date/time picker */
            <div className="py-4 flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">Choose a date and time</p>
              <input
                type="datetime-local"
                id="reminder-datetime-input"
                value={customDateTime}
                onChange={(e) => setCustomDateTime(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
                className="w-full rounded-lg border border-input bg-background dark:bg-[#303134] text-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowDatePicker(false)}
                >
                  Back
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleCustomDateConfirm}
                  disabled={!customDateTime}
                >
                  Set reminder
                </Button>
              </div>
            </div>
          ) : (
            /* Quick-pick options */
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

              {/* Remove reminder row — only if one is already set */}
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
          )}
        </div>
      </div>
    </>,
    document.body
  );
};

export default ReminderSheet;
