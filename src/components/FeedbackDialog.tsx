import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThumbsUp, ThumbsDown, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import confetti from "canvas-confetti";

interface FeedbackDialogProps {
  isOpen: boolean;
  onClose: (skipped: boolean) => void;
  onSubmit: (feedback: "happy" | "sad", comments: string) => void;
}

const FeedbackDialog: React.FC<FeedbackDialogProps> = ({ isOpen, onClose, onSubmit }) => {
  const [feedback, setFeedback] = useState<"happy" | "sad" | null>(null);
  const [comments, setComments] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  const platform = Capacitor.getPlatform();
  const isMobile = platform === 'ios' || platform === 'android';

  const handleSubmit = () => {
    if (!feedback) return;
    onSubmit(feedback, comments);
    
    if (feedback === "happy") {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        zIndex: 999999
      });
      if (isMobile) {
        setIsSubmitted(true);
      } else {
        setFeedback(null);
        setComments("");
        setIsSubmitted(false);
        onClose(false);
      }
    } else {
      // Reset state and close immediately for sad path
      setFeedback(null);
      setComments("");
      setIsSubmitted(false);
      onClose(false);
    }
  };

  const handleClose = () => {
    setFeedback(null);
    setComments("");
    setIsSubmitted(false);
    onClose(true);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        className="sm:max-w-md bg-background text-text-primary dark:text-text-primary border"
      >
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle className="text-xl font-semibold">
            {isSubmitted ? "Thank you!" : "Would you recommend the app?"}
          </DialogTitle>
          <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </Button>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-4">
          {isSubmitted ? (
            <div className="flex flex-col items-center gap-4 text-center animate-in fade-in zoom-in duration-300">
              <p className="text-lg">Thank you for your feedback!</p>
              {isMobile && (
                <>
                  <p className="text-muted-foreground text-sm">
                    Would you mind leaving us a review on the {platform === 'ios' ? 'App Store' : 'Google Play'}? It really helps!
                  </p>
                  <Button 
                    className="w-full mt-2" 
                    onClick={() => {
                      const url = platform === 'ios' 
                        ? 'https://apps.apple.com/gb/app/open-keep/id6775857379'
                        : 'https://play.google.com/store/apps/details?id=com.jackbarkerapps.openkeep&hl=en_GB';
                      window.open(url, '_blank');
                      handleClose();
                    }}
                  >
                    Leave a Review
                  </Button>
                </>
              )}
              <Button variant="outline" className="w-full" onClick={handleClose}>
                {isMobile ? "Maybe Later" : "Close"}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex justify-center gap-8">
                <Button
                  variant={feedback === "happy" ? "default" : "outline"}
                  className="w-24 h-24 flex flex-col items-center justify-center gap-2"
                  onClick={() => setFeedback("happy")}
                >
                  <ThumbsUp className="h-8 w-8" />
                  <span>Yes</span>
                </Button>
                <Button
                  variant={feedback === "sad" ? "default" : "outline"}
                  className="w-24 h-24 flex flex-col items-center justify-center gap-2"
                  onClick={() => setFeedback("sad")}
                >
                  <ThumbsDown className="h-8 w-8" />
                  <span>No</span>
                </Button>
              </div>

              {feedback && (
                <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2">
                  <label htmlFor="comments" className="text-sm font-medium">
                    {feedback === "happy"
                      ? "What do you like about it? (Optional)"
                      : "What could we improve? (Optional)"}
                  </label>
                  <Textarea
                    id="comments"
                    placeholder="Leave your comments here..."
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    className="resize-none"
                    rows={4}
                  />
                  <Button onClick={handleSubmit} className="w-full mt-2">
                    Submit Feedback
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FeedbackDialog;
