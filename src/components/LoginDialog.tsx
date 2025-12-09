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
                    brand: 'hsl(var(--primary))',
                    brandAccent: 'hsl(var(--primary-foreground))',
                    // Customizing the "Sign in" button text color
                    defaultButtonText: 'hsl(240 1.5% 88.8%)', // Equivalent to #e2e2e3
                    anchorText: 'hsl(240 1.5% 88.8%)', // For links like "Forgot your password?"
                  },
                },
              },
            }}
            theme="light"
            redirectTo={window.location.origin}
            localization={{
              variables: {
                sign_in: {
                  email_is_required_error: 'Please enter your email address.', // Custom error message
                },
                sign_up: {
                  email_is_required_error: 'Please enter your email address.',
                },
                forgotten_password: {
                  email_is_required_error: 'Please enter your email address.',
                },
              },
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoginDialog;