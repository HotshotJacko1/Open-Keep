import React from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from '@/integrations/supabase/client';

interface LoginDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const LoginDialog: React.FC<LoginDialogProps> = ({ isOpen, onClose }) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Login to your account</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <Auth
            supabaseClient={supabase}
            providers={['google']}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: 'hsl(var(--primary))', // Primary button background
                    brandAccent: 'hsl(var(--primary-foreground))', // Primary button hover background
                    text: 'hsl(var(--foreground))', // General text color, might influence button text
                  },
                },
                button: {
                  colors: {
                    buttonText: 'hsl(var(--foreground))', // Explicitly set the text color for buttons
                    buttonForeground: 'hsl(var(--foreground))', // Also keep buttonForeground for broader compatibility
                  },
                },
              },
            }}
            localization={{
              variables: {
                validation_faults: {
                  missing_email_or_phone: 'missing email or password',
                },
              },
            }}
            theme="light"
            redirectTo={window.location.origin}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoginDialog;